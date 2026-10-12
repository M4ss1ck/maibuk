import { RemoteReceiver } from "@remote-dom/core/receivers";
import {
  MUTATION_TYPE_INSERT_CHILD,
  MUTATION_TYPE_REMOVE_CHILD,
  MUTATION_TYPE_UPDATE_PROPERTY,
  UPDATE_PROPERTY_TYPE_ATTRIBUTE,
  UPDATE_PROPERTY_TYPE_EVENT_LISTENER,
  type RemoteMutationRecord,
  type RemoteNodeSerialization,
} from "@remote-dom/core";
import { describe, expect, it } from "vitest";
import { createPluginRemoteUi } from "@/features/plugins/remote-ui/receiver";
import {
  createValidatedConnection,
  type PluginUiViolation,
} from "@/features/plugins/remote-ui/validate";

const ROOT = "~";

function insert(child: RemoteNodeSerialization, index = 0): RemoteMutationRecord {
  return [MUTATION_TYPE_INSERT_CHILD, ROOT, child, index];
}

function element(
  id: string,
  tag: string,
  extra: Partial<RemoteNodeSerialization> = {}
): RemoteNodeSerialization {
  return { id, type: 1, element: tag, children: [], ...extra } as RemoteNodeSerialization;
}

function setup(limits?: Parameters<typeof createValidatedConnection>[0]["limits"]) {
  const receiver = new RemoteReceiver();
  const violations: PluginUiViolation[] = [];
  const connection = createValidatedConnection({
    receiver,
    onViolation: (violation) => violations.push(violation),
    ...(limits === undefined ? {} : { limits }),
  });
  return { receiver, violations, connection };
}

describe("the connection validator", () => {
  it("accepts a supported tree and stores it", () => {
    const { receiver, violations, connection } = setup();
    connection.mutate([insert(element("1", "maibuk-text"))]);
    expect(violations).toEqual([]);
    expect(receiver.root.children).toHaveLength(1);
  });

  it("refuses an unknown element and applies none of the batch", () => {
    const { receiver, violations, connection } = setup();
    connection.mutate([
      insert(element("1", "maibuk-text")),
      insert(element("2", "maibuk-evil"), 1),
    ]);
    expect(violations[0]?.code).toBe("unknown-element");
    expect(violations[0]?.tag).toBe("maibuk-evil");
    expect(receiver.root.children).toHaveLength(0);
  });

  it("refuses an unknown prop", () => {
    const { violations, connection } = setup();
    connection.mutate([insert(element("1", "maibuk-button", { properties: { nope: 1 } }))]);
    expect(violations[0]?.code).toBe("unknown-prop");
    expect(violations[0]?.prop).toBe("nope");
  });

  it("refuses an invalid prop value", () => {
    const { violations, connection } = setup();
    connection.mutate([insert(element("1", "maibuk-button", { properties: { variant: "huge" } }))]);
    expect(violations[0]?.code).toBe("invalid-prop");
  });

  it("refuses an image source that is not a data URL", () => {
    const { violations, connection } = setup();
    connection.mutate([
      insert(element("1", "maibuk-image", { properties: { src: "https://x/y.png", alt: "x" } })),
    ]);
    expect(violations[0]?.code).toBe("invalid-prop");
    expect(violations[0]?.prop).toBe("src");
  });

  it("refuses a required prop that is missing", () => {
    const { violations, connection } = setup();
    connection.mutate([insert(element("1", "maibuk-text-field", { properties: { value: "x" } }))]);
    expect(violations[0]?.code).toBe("invalid-prop");
    expect(violations[0]?.prop).toBe("label");
  });

  it("refuses a script URL in a link", () => {
    const { violations, connection } = setup();
    connection.mutate([
      insert(element("1", "maibuk-link", { properties: { href: "javascript:alert(1)" } })),
    ]);
    expect(violations[0]?.code).toBe("invalid-prop");
    expect(violations[0]?.prop).toBe("href");
  });

  it("refuses an unknown event", () => {
    const { violations, connection } = setup();
    connection.mutate([
      insert(element("1", "maibuk-button", { eventListeners: { bogus: () => {} } })),
    ]);
    expect(violations[0]?.code).toBe("unknown-event");
  });

  it("validates a later property update against the inserted element", () => {
    const { violations, connection } = setup();
    connection.mutate([insert(element("1", "maibuk-button"))]);
    connection.mutate([[MUTATION_TYPE_UPDATE_PROPERTY, "1", "nope", 1]]);
    expect(violations[0]?.code).toBe("unknown-prop");
  });

  it("refuses an attribute update", () => {
    const { violations, connection } = setup();
    connection.mutate([insert(element("1", "maibuk-button"))]);
    connection.mutate([
      [MUTATION_TYPE_UPDATE_PROPERTY, "1", "title", "x", UPDATE_PROPERTY_TYPE_ATTRIBUTE],
    ]);
    expect(violations[0]?.code).toBe("unknown-prop");
  });

  it("refuses a property update for an element the interface never inserted", () => {
    const { violations, connection } = setup();
    connection.mutate([[MUTATION_TYPE_UPDATE_PROPERTY, "missing", "label", "x"]]);
    expect(violations[0]?.code).toBe("unknown-element");
  });

  it("accepts a removal and keeps validating the rest of the tree", () => {
    const { receiver, violations, connection } = setup();
    connection.mutate([
      insert(
        element("1", "maibuk-view", {
          children: [
            element("2", "maibuk-list", {
              children: [element("3", "maibuk-text")],
            }),
          ],
        })
      ),
    ]);
    connection.mutate([[MUTATION_TYPE_REMOVE_CHILD, "1", 0]]);
    expect(violations).toEqual([]);
    expect(receiver.root.children).toHaveLength(1);
  });

  it("accepts a declared event listener update", () => {
    const { violations, connection } = setup();
    connection.mutate([insert(element("1", "maibuk-button"))]);
    connection.mutate([
      [MUTATION_TYPE_UPDATE_PROPERTY, "1", "press", () => {}, UPDATE_PROPERTY_TYPE_EVENT_LISTENER],
    ]);
    expect(violations).toEqual([]);
  });

  it("refuses a method the element does not declare", () => {
    const { violations, connection } = setup();
    connection.mutate([insert(element("1", "maibuk-button"))]);
    connection.call("1", "focus");
    expect(violations[0]?.code).toBe("unknown-method");
  });

  it("refuses a batch with too many records", () => {
    const { violations, connection } = setup({ maxNodes: 10, maxRecordsPerBatch: 1 });
    connection.mutate([insert(element("1", "maibuk-text")), insert(element("2", "maibuk-text"), 1)]);
    expect(violations[0]?.code).toBe("too-many-records");
  });

  it("refuses a tree over the node budget", () => {
    const { violations, connection } = setup({ maxNodes: 1, maxRecordsPerBatch: 10 });
    connection.mutate([insert(element("1", "maibuk-text")), insert(element("2", "maibuk-text"), 1)]);
    expect(violations[0]?.code).toBe("too-many-nodes");
  });

  it("stops reporting after the first refusal", () => {
    const { violations, connection } = setup();
    connection.mutate([insert(element("1", "maibuk-evil"))]);
    connection.mutate([insert(element("2", "maibuk-evil"))]);
    expect(violations).toHaveLength(1);
  });
});

describe("createPluginRemoteUi", () => {
  it("releases the receiver and callbacks on dispose", () => {
    const ui = createPluginRemoteUi({ onViolation: () => {} });
    ui.dispose();
    expect(ui.disposed).toBe(true);
    expect(ui.components.size).toBe(0);
  });

  it("does not report after dispose", () => {
    const violations: PluginUiViolation[] = [];
    const ui = createPluginRemoteUi({ onViolation: (v) => violations.push(v) });
    ui.dispose();
    ui.connection.mutate([insert(element("1", "maibuk-evil"))]);
    expect(violations).toEqual([]);
  });
});
