import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { noteReferenceSource } from "@/features/canvas/noteReferenceSource";
import {
  canvasReferenceKey,
  type CanvasReferenceOpenContext,
  type CanvasReferenceResolution,
  logCanvasReferencePlaced,
  markCanvasReferenceMissing,
  openCanvasReference,
  useCanvasReferenceResolution,
  useCanvasReferenceResolutions,
  useResolveCanvasReferences,
} from "@/features/canvas/references";
import { useCanvasStore } from "@/features/canvas/store";
import type { CanvasNode } from "@/features/canvas/types";
import { type Note, useNoteStore } from "@/features/notes";

/**
 * The answers a Canvas Reference gets live only in memory: one ask per source
 * when the Canvas opens, a fresh ask when the source says it changed, and
 * nothing written into the Canvas document or the canvas store.
 */

function referenceNode(id: string, source: string, targetId: string): CanvasNode {
  return { id, kind: "reference", source, targetId, position: { x: 0, y: 0 } };
}

const present = (label: string): CanvasReferenceResolution => ({
  status: "present",
  title: label,
  value: { label },
});

function noteRow(overrides: Partial<Note> = {}): Note {
  return {
    id: "note-a",
    title: "Alpha",
    content: "",
    language: "en",
    tags: [],
    pinned: false,
    order: 0,
    wordCount: 0,
    collapsedHeadings: [],
    createdAt: 1,
    updatedAt: 1,
    contentUpdatedAt: 1,
    ...overrides,
  };
}

function renderReferences(nodes: CanvasNode[]) {
  return renderHook(
    ({ nodes: current }: { nodes: CanvasNode[] }) => {
      useResolveCanvasReferences(current);
      return {
        a: useCanvasReferenceResolution("note", "note-a"),
        b: useCanvasReferenceResolution("note", "note-b"),
      };
    },
    { initialProps: { nodes } }
  );
}

const answersFor = (ids: readonly string[]) =>
  Object.fromEntries(ids.map((id) => [id, present(id)]));

beforeEach(() => {
  useCanvasReferenceResolutions.getState().clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  useCanvasReferenceResolutions.getState().clear();
});

describe("useResolveCanvasReferences()", () => {
  it("asks each known source once for its unanswered targets", async () => {
    const resolve = vi
      .spyOn(noteReferenceSource, "resolve")
      .mockImplementation(async (ids) => answersFor(ids));

    const { result } = renderReferences([
      referenceNode("node-1", "note", "note-a"),
      referenceNode("node-2", "note", "note-b"),
      referenceNode("node-3", "plugin.x.y", "item-1"),
    ]);

    await waitFor(() => expect(result.current.b).toEqual(present("note-b")));

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith(["note-a", "note-b"]);
    expect(useCanvasReferenceResolutions.getState().resolutions).toEqual({
      [canvasReferenceKey("note", "note-a")]: present("note-a"),
      [canvasReferenceKey("note", "note-b")]: present("note-b"),
    });
    expect(result.current.a).toEqual(present("note-a"));
  });

  it("leaves the canvas document and revision untouched", async () => {
    const resolve = vi
      .spyOn(noteReferenceSource, "resolve")
      .mockImplementation(async (ids) => answersFor(ids));
    const before = useCanvasStore.getState();

    const { result } = renderReferences([referenceNode("node-1", "note", "note-a")]);

    await waitFor(() => expect(result.current.a).toEqual(present("note-a")));
    expect(resolve).toHaveBeenCalled();
    const after = useCanvasStore.getState();
    expect(after.revision).toBe(before.revision);
    expect(after.doc).toBe(before.doc);
  });

  it("stays unresolved and warns once when the source rejects", async () => {
    const error = new Error("database closed");
    vi.spyOn(noteReferenceSource, "resolve").mockRejectedValue(error);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { result } = renderReferences([referenceNode("node-1", "note", "note-a")]);

    await waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    expect(warn).toHaveBeenCalledWith("[canvas] reference resolve failed", {
      source: "note",
      error,
    });
    expect(useCanvasReferenceResolutions.getState().resolutions).toEqual({});
    expect(result.current.a).toBeUndefined();
  });

  it("asks again for every target when the source says it changed", async () => {
    const listeners: Array<() => void> = [];
    vi.spyOn(noteReferenceSource, "subscribe").mockImplementation((listener) => {
      listeners.push(listener);
      return () => {
        listeners.splice(listeners.indexOf(listener), 1);
      };
    });
    const resolve = vi
      .spyOn(noteReferenceSource, "resolve")
      .mockResolvedValueOnce({ "note-a": present("Alpha") })
      .mockResolvedValue({ "note-a": { status: "missing" } });

    const { result } = renderReferences([referenceNode("node-1", "note", "note-a")]);

    await waitFor(() => expect(result.current.a).toEqual(present("Alpha")));
    expect(listeners).toHaveLength(1);

    act(() => {
      for (const listener of listeners) listener();
    });

    await waitFor(() => expect(result.current.a).toEqual({ status: "missing" }));
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(resolve).toHaveBeenLastCalledWith(["note-a"]);
  });

  it("resolves only the newly added reference on a rerender", async () => {
    const resolve = vi
      .spyOn(noteReferenceSource, "resolve")
      .mockImplementation(async (ids) => answersFor(ids));

    const { result, rerender } = renderReferences([referenceNode("node-1", "note", "note-a")]);

    await waitFor(() => expect(result.current.a).toEqual(present("note-a")));
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenLastCalledWith(["note-a"]);

    rerender({
      nodes: [referenceNode("node-1", "note", "note-a"), referenceNode("node-2", "note", "note-b")],
    });

    await waitFor(() => expect(result.current.b).toEqual(present("note-b")));
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(resolve).toHaveBeenLastCalledWith(["note-b"]);
  });
});

describe("openCanvasReference()", () => {
  const context: CanvasReferenceOpenContext = {
    canvasId: "canvas-1",
    canvasTitle: "My canvas",
    navigate: (() => {}) as unknown as CanvasReferenceOpenContext["navigate"],
  };

  it("answers failed, logs it, and never throws when the source's open rejects", async () => {
    vi.spyOn(noteReferenceSource, "open").mockRejectedValue(new Error("boom"));
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});

    const result = await openCanvasReference({ source: "note", targetId: "note-a" }, context);

    expect(result).toBe("failed");
    expect(debug).toHaveBeenCalledTimes(1);
    expect(debug).toHaveBeenCalledWith("[canvas] reference open", {
      source: "note",
      result: "failed",
    });
    expect(useCanvasReferenceResolutions.getState().resolutions).toEqual({});
  });

  it("opens a present target and logs the result", async () => {
    vi.spyOn(noteReferenceSource, "open").mockResolvedValue("opened");
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});

    const result = await openCanvasReference({ source: "note", targetId: "note-a" }, context);

    expect(result).toBe("opened");
    expect(debug).toHaveBeenCalledTimes(1);
    expect(debug).toHaveBeenCalledWith("[canvas] reference open", {
      source: "note",
      result: "opened",
    });
  });

  it("marks the reference missing when the target is gone", async () => {
    vi.spyOn(noteReferenceSource, "open").mockResolvedValue("missing");
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});

    const result = await openCanvasReference({ source: "note", targetId: "note-gone" }, context);

    expect(result).toBe("missing");
    expect(
      useCanvasReferenceResolutions.getState().resolutions[canvasReferenceKey("note", "note-gone")]
    ).toEqual({ status: "missing" });
    expect(debug).toHaveBeenCalledWith("[canvas] reference open", {
      source: "note",
      result: "missing",
    });
  });

  it("answers unavailable for an unknown source", async () => {
    const open = vi.spyOn(noteReferenceSource, "open").mockResolvedValue("opened");
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});

    const result = await openCanvasReference({ source: "plugin.x.y", targetId: "item-1" }, context);

    expect(result).toBe("unavailable");
    expect(open).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledTimes(1);
    expect(debug).toHaveBeenCalledWith("[canvas] reference open", {
      source: "plugin.x.y",
      result: "unavailable",
    });
  });
});

describe("canvas reference logs", () => {
  it("marks a reference missing and logs a placement", () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});

    markCanvasReferenceMissing("note", "note-a");
    logCanvasReferencePlaced("note");

    expect(useCanvasReferenceResolutions.getState().resolutions).toEqual({
      [canvasReferenceKey("note", "note-a")]: { status: "missing" },
    });
    expect(debug).toHaveBeenCalledWith("[canvas] reference placed", {
      source: "note",
      result: "placed",
    });
  });
});

describe("the real Note source", () => {
  it("turns a reference Missing when its Note is deleted, keeping the node", async () => {
    useNoteStore.setState({
      notes: [noteRow()],
      loadNotes: vi.fn().mockResolvedValue(undefined),
    });
    const nodes = [referenceNode("node-1", "note", "note-a")];

    const { result } = renderHook(
      ({ current }: { current: CanvasNode[] }) => {
        useResolveCanvasReferences(current);
        return useCanvasReferenceResolution("note", "note-a");
      },
      { initialProps: { current: nodes } }
    );

    await waitFor(() =>
      expect(result.current).toEqual(expect.objectContaining({ status: "present", title: "Alpha" }))
    );

    act(() => {
      useNoteStore.setState({ notes: [] });
    });

    await waitFor(() => expect(result.current).toEqual({ status: "missing" }));
    expect(nodes).toEqual([referenceNode("node-1", "note", "note-a")]);
  });
});

describe("the Note source's first read", () => {
  it("fails instead of answering missing when the Notes read failed, and reads again next time", async () => {
    vi.resetModules();
    const notes = await import("@/features/notes");
    const { noteReferenceSource: source } = await import("@/features/canvas/noteReferenceSource");
    const note = { id: "n1", title: "Lighthouse", order: 0 } as Note;
    const loadNotes = vi
      .fn()
      .mockImplementationOnce(async () => notes.useNoteStore.setState({ error: "read failed" }))
      .mockImplementationOnce(async () =>
        notes.useNoteStore.setState({ error: null, notes: [note] })
      );
    notes.useNoteStore.setState({ notes: [], error: null, loadNotes });

    await expect(source.resolve(["n1"])).rejects.toThrow("read failed");
    await expect(source.resolve(["n1"])).resolves.toEqual({
      n1: { status: "present", title: "Lighthouse", value: note },
    });
    expect(loadNotes).toHaveBeenCalledTimes(2);
  });
});
