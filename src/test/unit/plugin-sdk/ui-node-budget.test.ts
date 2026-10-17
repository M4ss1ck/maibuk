/**
 * The Plugin-side element counter (#516, decision 2a). The count is live
 * elements, made in the UI kit's constructor and released by removal records.
 * It is enabled only in a Plugin Worker, so these tests turn it on explicitly.
 */
import {
  MUTATION_TYPE_INSERT_CHILD,
  MUTATION_TYPE_REMOVE_CHILD,
  NODE_TYPE_ELEMENT,
  NODE_TYPE_TEXT,
  type RemoteMutationRecord,
} from "@remote-dom/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  countRemoteElement,
  createRemovalWatch,
  disableRemoteElementCount,
  enableRemoteElementCount,
  remoteElementCount,
  resetRemoteElementCount,
} from "@/plugin-sdk/ui-node-budget";
import {
  PLUGIN_UI_NODE_LIMIT,
  PLUGIN_UI_NODE_LIMIT_MARKER,
} from "@/plugin-sdk/ui-node-limit";
import { PLUGIN_UI_LIMITS } from "@/plugin-sdk/ui-table";

const ROOT = "~";

function element(id: string, children: unknown[] = []): unknown {
  return { id, type: NODE_TYPE_ELEMENT, element: "ui-view", children };
}

function text(id: string): unknown {
  return { id, type: NODE_TYPE_TEXT, data: "x" };
}

function insert(parent: string, child: unknown): RemoteMutationRecord {
  return [MUTATION_TYPE_INSERT_CHILD, parent, child] as unknown as RemoteMutationRecord;
}

function remove(parent: string, index: number): RemoteMutationRecord {
  return [MUTATION_TYPE_REMOVE_CHILD, parent, index] as unknown as RemoteMutationRecord;
}

/** Makes `count` elements, the way the UI kit's constructor does. */
function make(count: number): void {
  for (let index = 0; index < count; index += 1) countRemoteElement();
}

beforeEach(() => {
  enableRemoteElementCount();
  resetRemoteElementCount();
});

afterEach(() => {
  resetRemoteElementCount();
});

describe("the Plugin-side element counter", () => {
  it("shares the host's limit, not a second number", () => {
    expect(PLUGIN_UI_NODE_LIMIT).toBe(PLUGIN_UI_LIMITS.maxNodes);
  });

  it("trips at the (limit + 1)th live element, with the marker", () => {
    make(PLUGIN_UI_NODE_LIMIT);
    expect(remoteElementCount()).toBe(PLUGIN_UI_NODE_LIMIT);
    let thrown: unknown;
    try {
      countRemoteElement();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe(PLUGIN_UI_NODE_LIMIT_MARKER);
  });

  it("counts nothing outside a Plugin Worker", () => {
    disableRemoteElementCount();
    // A host renderer that never enabled the count: constructing elements is free.
    make(PLUGIN_UI_NODE_LIMIT + 5);
    expect(remoteElementCount()).toBe(0);
  });

  it("releases the elements a removal takes away, so churn under the limit never trips", () => {
    const watch = createRemovalWatch();
    // Five rounds of a 3,000-element subtree: under the limit at every step.
    for (let round = 0; round < 5; round += 1) {
      make(3_000);
      const subtree = element(`r${round}`, Array.from({ length: 2_999 }, (_, i) => element(`r${round}-${i}`)));
      watch.observe([insert(ROOT, subtree)]);
      watch.observe([remove(ROOT, 0)]);
      expect(remoteElementCount()).toBe(0);
    }
  });

  it("releases only elements, never text nodes", () => {
    const watch = createRemovalWatch();
    make(2);
    watch.observe([insert(ROOT, element("a", [text("t1"), element("b")]))]);
    watch.observe([remove(ROOT, 0)]);
    expect(remoteElementCount()).toBe(0);
  });

  it("resets to zero when the last mount is gone", () => {
    make(500);
    resetRemoteElementCount();
    expect(remoteElementCount()).toBe(0);
  });
});
