import { describe, expect, it } from "vitest";
import { dropTargetFromPoint } from "@/lib/drop-target";

/** Builds a container with rows whose getBoundingClientRect is stubbed. */
function buildList(rows: Array<{ id: string; top: number; bottom: number }>) {
  const container = document.createElement("div");
  for (const row of rows) {
    const el = document.createElement("div");
    el.setAttribute("data-drop-id", row.id);
    el.getBoundingClientRect = () =>
      ({
        top: row.top,
        bottom: row.bottom,
        height: row.bottom - row.top,
      }) as DOMRect;
    container.appendChild(el);
  }
  return container;
}

describe("dropTargetFromPoint()", () => {
  const container = buildList([
    { id: "a", top: 0, bottom: 40 },
    { id: "b", top: 40, bottom: 80 },
    { id: "c", top: 80, bottom: 120 },
  ]);

  it("targets the row under the pointer, placement by midpoint", () => {
    expect(
      dropTargetFromPoint(container, 10, "[data-drop-id]", "data-drop-id"),
    ).toEqual({
      id: "a",
      placement: "before",
    });
    expect(
      dropTargetFromPoint(container, 35, "[data-drop-id]", "data-drop-id"),
    ).toEqual({
      id: "a",
      placement: "after",
    });
    expect(
      dropTargetFromPoint(container, 100, "[data-drop-id]", "data-drop-id"),
    ).toEqual({
      id: "c",
      placement: "after",
    });
  });

  it("falls back to the nearest row outside all spans", () => {
    expect(
      dropTargetFromPoint(container, 500, "[data-drop-id]", "data-drop-id"),
    ).toEqual({
      id: "c",
      placement: "after",
    });
    expect(
      dropTargetFromPoint(container, -50, "[data-drop-id]", "data-drop-id"),
    ).toEqual({
      id: "a",
      placement: "before",
    });
  });

  it("returns null when nothing matches the selector", () => {
    expect(
      dropTargetFromPoint(
        document.createElement("div"),
        10,
        "[data-drop-id]",
        "data-drop-id",
      ),
    ).toBeNull();
  });
});
