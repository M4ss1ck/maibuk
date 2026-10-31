/**
 * The Plugin-side node budget, per mount (#516, decision 2a). The host checks
 * the limit per mount, and counts text nodes as well as elements; these tests pin
 * the same measure. The count is enabled here, as the Worker entry enables it.
 */
import {
  MUTATION_TYPE_INSERT_CHILD,
  MUTATION_TYPE_REMOVE_CHILD,
  NODE_TYPE_ELEMENT,
  NODE_TYPE_TEXT,
  type RemoteMutationRecord,
} from "@remote-dom/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installPluginUiElements } from "@/plugin-sdk/ui";
import {
  countRemoteNode,
  createMountBudget,
  createRemovalWatch,
  disableRemoteElementCount,
  enableRemoteElementCount,
  type MountBudget,
  renderingWithin,
  setRemoteElementLimitHandler,
} from "@/plugin-sdk/ui-node-budget";
import { PLUGIN_UI_NODE_LIMIT } from "@/plugin-sdk/ui-node-limit";
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

/** Makes `count` nodes while `budget` is the mount rendering them. */
function render(budget: MountBudget, count: number): void {
  renderingWithin(budget, () => {
    for (let index = 0; index < count; index += 1) countRemoteNode();
  });
}

let onLimit: ReturnType<typeof vi.fn<() => void>>;

beforeEach(() => {
  onLimit = vi.fn<() => void>();
  setRemoteElementLimitHandler(onLimit);
  enableRemoteElementCount();
});

afterEach(() => {
  setRemoteElementLimitHandler(null);
  disableRemoteElementCount();
});

describe("the Plugin-side node budget, per mount", () => {
  it("shares the host's limit, not a second number", () => {
    expect(PLUGIN_UI_NODE_LIMIT).toBe(PLUGIN_UI_LIMITS.maxNodes);
  });

  it("two mounts at 6,000 nodes each never trip, because the host counts each mount alone", () => {
    const first = createMountBudget();
    const second = createMountBudget();
    render(first, 6_000);
    render(second, 6_000);
    expect(first.live).toBe(6_000);
    expect(second.live).toBe(6_000);
    expect(onLimit).not.toHaveBeenCalled();
  });

  it("one page re-rendering 200 times at 500 nodes never trips", () => {
    const budget = createMountBudget();
    const watch = createRemovalWatch(budget);
    for (let round = 0; round < 200; round += 1) {
      render(budget, 500);
      const subtree = element(
        `r${round}`,
        Array.from({ length: 499 }, (_, i) => element(`r${round}-${i}`))
      );
      watch.observe([insert(ROOT, subtree)]);
      watch.observe([remove(ROOT, 0)]);
      expect(budget.live).toBe(0);
    }
    expect(onLimit).not.toHaveBeenCalled();
  });

  it("the flood trips the limit once, at the (limit + 1)th node, and stays quiet after", () => {
    const budget = createMountBudget();
    render(budget, PLUGIN_UI_NODE_LIMIT);
    expect(onLimit).not.toHaveBeenCalled();
    render(budget, 1);
    expect(onLimit).toHaveBeenCalledTimes(1);
    render(budget, 500);
    expect(onLimit).toHaveBeenCalledTimes(1);
  });

  it("counts the real kit tags made during a mount's first render", () => {
    installPluginUiElements();
    const budget = createMountBudget();
    renderingWithin(budget, () => {
      for (let index = 0; index < PLUGIN_UI_NODE_LIMIT + 5; index += 1) {
        document.createElement("maibuk-text");
      }
    });
    expect(budget.live).toBe(PLUGIN_UI_NODE_LIMIT + 5);
    expect(onLimit).toHaveBeenCalledTimes(1);
  });

  it("an unmounted mount's nodes no longer count", () => {
    const budget = createMountBudget();
    render(budget, 100);
    budget.dispose();
    render(budget, PLUGIN_UI_NODE_LIMIT + 5);
    expect(budget.live).toBe(0);
    expect(onLimit).not.toHaveBeenCalled();
  });

  it("nodes made outside any mount's render do not count", () => {
    const budget = createMountBudget();
    countRemoteNode();
    expect(budget.live).toBe(0);
  });

  it("counts nothing outside a Plugin Worker", () => {
    disableRemoteElementCount();
    const budget = createMountBudget();
    render(budget, PLUGIN_UI_NODE_LIMIT + 5);
    expect(budget.live).toBe(0);
    expect(onLimit).not.toHaveBeenCalled();
  });

  it("a removal releases the elements and text nodes it takes out, and only those", () => {
    const budget = createMountBudget();
    const watch = createRemovalWatch(budget);
    render(budget, 3);
    watch.observe([insert(ROOT, element("a", [text("t1"), element("b")]))]);
    expect(budget.live).toBe(3);
    watch.observe([remove(ROOT, 0)]);
    expect(budget.live).toBe(0);
  });
});
