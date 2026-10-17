/**
 * The Plugin-side node budget (#516, decision 2a). It mirrors the host's counting
 * rules, so the Plugin trips at the same node the host would refuse. Only the
 * native lane's tree shapes are asserted here; the host check is tested in
 * `plugin-ui-validate.test.ts`.
 */
import { MUTATION_TYPE_INSERT_CHILD, MUTATION_TYPE_REMOVE_CHILD, type RemoteMutationRecord } from "@remote-dom/core";
import { describe, expect, it } from "vitest";
import { createPluginNodeBudget } from "@/plugin-sdk/ui-node-budget";

const ROOT = "~";

/** An element serialization with its children, the shape an insert carries. */
function element(id: string, children: unknown[] = []): unknown {
  return { id, type: 1, element: "ui-view", children };
}

function insert(parent: string, child: unknown, index?: number): RemoteMutationRecord {
  return index === undefined
    ? ([MUTATION_TYPE_INSERT_CHILD, parent, child] as unknown as RemoteMutationRecord)
    : ([MUTATION_TYPE_INSERT_CHILD, parent, child, index] as unknown as RemoteMutationRecord);
}

function remove(parent: string, index: number): RemoteMutationRecord {
  return [MUTATION_TYPE_REMOVE_CHILD, parent, index] as unknown as RemoteMutationRecord;
}

describe("the Plugin-side node budget", () => {
  it("counts an insert as its whole serialized subtree", () => {
    const budget = createPluginNodeBudget(100);
    expect(budget.apply([insert(ROOT, element("a", [element("b", [{ id: "t", type: 3, data: "x" }])]))])).toBe(true);
    expect(budget.nodes).toBe(3);
  });

  it("takes a removed subtree away, so churn under the limit never trips it", () => {
    const budget = createPluginNodeBudget(3);
    expect(budget.apply([insert(ROOT, element("a", [element("b")]))])).toBe(true);
    expect(budget.nodes).toBe(2);
    expect(budget.apply([remove(ROOT, 0)])).toBe(true);
    expect(budget.nodes).toBe(0);
    // Re-inserting the same shape later is fine: the live count is what counts.
    expect(budget.apply([insert(ROOT, element("c", [element("d")]))])).toBe(true);
    expect(budget.nodes).toBe(2);
  });

  it("trips at the first record past the limit, and stays tripped", () => {
    const budget = createPluginNodeBudget(2);
    expect(budget.apply([insert(ROOT, element("a"))])).toBe(true);
    expect(budget.apply([insert(ROOT, element("b"))])).toBe(true);
    expect(budget.apply([insert(ROOT, element("c"))])).toBe(false);
    expect(budget.apply([remove(ROOT, 0)])).toBe(false);
  });

  it("honours an insert index", () => {
    const budget = createPluginNodeBudget(10);
    budget.apply([insert(ROOT, element("a")), insert(ROOT, element("b")), insert(ROOT, element("c"), 0)]);
    expect(budget.nodes).toBe(3);
    budget.apply([remove(ROOT, 0)]);
    expect(budget.nodes).toBe(2);
  });

  it("refuses a 12,000-node flood at the limit, not after it", () => {
    const budget = createPluginNodeBudget(10_000);
    const flood = Array.from({ length: 12_000 }, (_, index) => insert(ROOT, element(`n${index}`)));
    expect(budget.apply(flood.slice(0, 10_000))).toBe(true);
    expect(budget.apply(flood.slice(10_000))).toBe(false);
  });
});
