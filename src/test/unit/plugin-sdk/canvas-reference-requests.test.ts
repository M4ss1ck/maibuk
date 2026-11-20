// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { canvasReferenceRequests } from "@/plugin-sdk";
import {
  PLUGIN_CANVAS_REFERENCE_LIST_REQUEST,
  PLUGIN_CANVAS_REFERENCE_OPEN_REQUEST,
  PLUGIN_CANVAS_REFERENCE_RESOLVE_REQUEST,
} from "@/plugin-sdk/protocol";

function source() {
  return {
    list: vi.fn((query: string) => [{ id: `list:${query}`, title: "Row" }]),
    resolve: vi.fn((ids: string[]) => ({
      [ids[0]]: { status: "missing" as const },
    })),
    open: vi.fn(() => "opened" as const),
  };
}

describe("canvasReferenceRequests", () => {
  it("dispatches each request to the named source and wraps list rows", async () => {
    const items = source();
    const notes = source();
    const handler = canvasReferenceRequests({ items, notes });

    await expect(
      handler(PLUGIN_CANVAS_REFERENCE_LIST_REQUEST, { source: "items", query: "abc" })
    ).resolves.toEqual({ rows: [{ id: "list:abc", title: "Row" }] });
    expect(items.list).toHaveBeenCalledWith("abc");
    expect(notes.list).not.toHaveBeenCalled();

    await expect(
      handler(PLUGIN_CANVAS_REFERENCE_RESOLVE_REQUEST, { source: "notes", ids: ["one"] })
    ).resolves.toEqual({ one: { status: "missing" } });
    expect(notes.resolve).toHaveBeenCalledWith(["one"]);
    expect(items.resolve).not.toHaveBeenCalled();

    await expect(
      handler(PLUGIN_CANVAS_REFERENCE_OPEN_REQUEST, { source: "notes", id: "one" })
    ).resolves.toBe("opened");
    expect(notes.open).toHaveBeenCalledWith("one");
  });

  it("throws an error naming an unknown source", async () => {
    const handler = canvasReferenceRequests({ items: source() });

    await expect(
      handler(PLUGIN_CANVAS_REFERENCE_LIST_REQUEST, { source: "missing", query: "" })
    ).rejects.toThrow(/missing/);
  });

  it("falls through to the next handler for another method", async () => {
    const next = vi.fn(async () => "done");
    const handler = canvasReferenceRequests({ items: source() }, next);

    await expect(handler("command.run", { id: "open" })).resolves.toBe("done");
    expect(next).toHaveBeenCalledWith("command.run", { id: "open" });
  });

  it("throws when another method arrives with no next handler", async () => {
    const handler = canvasReferenceRequests({ items: source() });

    await expect(handler("command.run", { id: "open" })).rejects.toThrow(
      "No handler for command.run"
    );
  });
});
