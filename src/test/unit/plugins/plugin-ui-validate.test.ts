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
import { PLUGIN_UI_LIMITS } from "@/plugin-sdk/ui-table";

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

function setup(
  limits?: Parameters<typeof createValidatedConnection>[0]["limits"],
  now: () => number = () => 0
) {
  const receiver = new RemoteReceiver();
  const violations: PluginUiViolation[] = [];
  const connection = createValidatedConnection({
    receiver,
    onViolation: (violation) => violations.push(violation),
    now,
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

  it("validates an update for an element inserted in the same batch", () => {
    const { receiver, violations, connection } = setup();
    connection.mutate([
      insert(element("1", "maibuk-button")),
      [MUTATION_TYPE_UPDATE_PROPERTY, "1", "isDisabled", true],
    ]);
    expect(violations).toEqual([]);
    expect(receiver.root.children).toHaveLength(1);
  });

  it("keeps an element re-inserted after its removal in the same batch", () => {
    const { receiver, violations, connection } = setup();
    connection.mutate([insert(element("1", "maibuk-button"))]);
    connection.mutate([
      [MUTATION_TYPE_REMOVE_CHILD, ROOT, 0],
      [MUTATION_TYPE_INSERT_CHILD, ROOT, element("1", "maibuk-button"), 0],
    ]);
    connection.mutate([[MUTATION_TYPE_UPDATE_PROPERTY, "1", "isDisabled", true]]);
    expect(violations).toEqual([]);
    expect(receiver.root.children).toHaveLength(1);
  });

  it("applies a move and the moved element's update in one batch", () => {
    const { receiver, violations, connection } = setup();
    connection.mutate([
      insert(element("row-a", "maibuk-button"), 0),
      insert(element("row-b", "maibuk-button"), 1),
    ]);
    // A keyed reorder moves row-b in front of row-a and disables it before the
    // batch is delivered.
    connection.mutate([
      [MUTATION_TYPE_REMOVE_CHILD, ROOT, 1],
      [MUTATION_TYPE_INSERT_CHILD, ROOT, element("row-b", "maibuk-button"), 0],
      [MUTATION_TYPE_UPDATE_PROPERTY, "row-b", "isDisabled", true],
    ]);
    expect(violations).toEqual([]);
    expect(receiver.root.children.map((child) => child.id)).toEqual(["row-b", "row-a"]);
  });

  it("does not commit any part of a batch that fails", () => {
    const { receiver, violations, connection } = setup();
    connection.mutate([
      insert(element("1", "maibuk-button")),
      insert(element("2", "maibuk-evil"), 1),
    ]);
    expect(violations[0]?.code).toBe("unknown-element");
    // The valid first record was not committed: a later update on it is unknown.
    connection.mutate([[MUTATION_TYPE_UPDATE_PROPERTY, "1", "isDisabled", true]]);
    expect(receiver.root.children).toHaveLength(0);
  });

  it("updates a descendant inserted as part of a subtree in the same batch", () => {
    const { receiver, violations, connection } = setup();
    connection.mutate([
      insert(
        element("1", "maibuk-view", {
          children: [element("2", "maibuk-button")],
        })
      ),
      [MUTATION_TYPE_UPDATE_PROPERTY, "2", "isDisabled", true],
    ]);
    expect(violations).toEqual([]);
    expect(receiver.root.children).toHaveLength(1);
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
    const { violations, connection } = setup({ maxNodes: 10, maxRecordsPerBatch: 1, maxBatchesPerSecond: 120 });
    connection.mutate([insert(element("1", "maibuk-text")), insert(element("2", "maibuk-text"), 1)]);
    expect(violations[0]?.code).toBe("too-many-records");
  });

  it("accepts 120 batches in one second", () => {
    let t = 0;
    const { receiver, violations, connection } = setup(undefined, () => t);
    for (let i = 0; i < 120; i++) {
      t = i * 8;
      connection.mutate([insert(element(`${i}`, "maibuk-text"), i)]);
    }
    expect(violations).toEqual([]);
    expect(receiver.root.children).toHaveLength(120);
  });

  it("refuses the 121st batch inside one second", () => {
    const { violations, connection } = setup(undefined, () => 0);
    for (let i = 0; i < 121; i++) {
      connection.mutate([insert(element(`${i}`, "maibuk-text"), i)]);
    }
    expect(violations[0]?.code).toBe("too-many-batches");
  });

  it("accepts again once the window slides", () => {
    let t = 0;
    const { receiver, violations, connection } = setup(undefined, () => t);
    for (let i = 0; i < 120; i++) {
      connection.mutate([insert(element(`${i}`, "maibuk-text"), i)]);
    }
    t = 1000;
    connection.mutate([insert(element("last", "maibuk-text"), 120)]);
    expect(violations).toEqual([]);
    expect(receiver.root.children).toHaveLength(121);
  });

  it("accepts back-to-back batches at the same instant under the cap", () => {
    const { receiver, violations, connection } = setup(undefined, () => 0);
    connection.mutate([insert(element("1", "maibuk-text"))]);
    connection.mutate([insert(element("2", "maibuk-text"), 1)]);
    expect(violations).toEqual([]);
    expect(receiver.root.children).toHaveLength(2);
  });

  it("carries the #401 Remote UI budget", () => {
    expect(PLUGIN_UI_LIMITS).toEqual({
      maxNodes: 10_000,
      maxRecordsPerBatch: 2_000,
      maxBatchesPerSecond: 120,
    });
  });

  it("refuses a tree over the node budget", () => {
    const { violations, connection } = setup({ maxNodes: 1, maxRecordsPerBatch: 10, maxBatchesPerSecond: 120 });
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
