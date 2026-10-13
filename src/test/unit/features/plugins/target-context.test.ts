/**
 * The context-target resolver: which item a targeted Plugin Command acts on
 * when it is invoked from somewhere other than an Item Menu (#446, the #397
 * contract). It reads the same stores the Item Menu path re-checks
 * (`pluginTargetIsLive`) and gates them by the active route, so a Chapter that
 * stays open in the store after the author leaves the editor is not the item
 * the author is in any more.
 */
import { describe, expect, it } from "vitest";
import {
  EMPTY_PLUGIN_ITEM_CONTEXT,
  pluginItemContextForPath,
  resolvePluginTarget,
  type PluginItemContext,
} from "@/features/plugins/target-context";

const full: PluginItemContext = {
  book: "b1",
  chapter: "c1",
  note: "n1",
  canvas: "v1",
  canvasNode: "node1",
};

describe("resolvePluginTarget", () => {
  it("returns the item for each declared kind", () => {
    expect(resolvePluginTarget(["book"], { ...EMPTY_PLUGIN_ITEM_CONTEXT, book: "b1" })).toEqual({
      kind: "book",
      id: "b1",
    });
    expect(
      resolvePluginTarget(["chapter"], { ...EMPTY_PLUGIN_ITEM_CONTEXT, chapter: "c1" })
    ).toEqual({ kind: "chapter", id: "c1" });
    expect(resolvePluginTarget(["note"], { ...EMPTY_PLUGIN_ITEM_CONTEXT, note: "n1" })).toEqual({
      kind: "note",
      id: "n1",
    });
    expect(
      resolvePluginTarget(["canvas"], { ...EMPTY_PLUGIN_ITEM_CONTEXT, canvas: "v1" })
    ).toEqual({ kind: "canvas", id: "v1" });
    expect(
      resolvePluginTarget(["canvasNode"], { ...EMPTY_PLUGIN_ITEM_CONTEXT, canvasNode: "node1" })
    ).toEqual({ kind: "canvasNode", id: "node1" });
  });

  it("prefers the most specific declared kind", () => {
    expect(resolvePluginTarget(["book", "chapter"], full)).toEqual({
      kind: "chapter",
      id: "c1",
    });
    expect(resolvePluginTarget(["book", "note"], full)).toEqual({ kind: "note", id: "n1" });
    expect(resolvePluginTarget(["canvas", "canvasNode"], full)).toEqual({
      kind: "canvasNode",
      id: "node1",
    });
    expect(resolvePluginTarget(["book", "chapter", "canvas"], full)).toEqual({
      kind: "chapter",
      id: "c1",
    });
  });

  it("returns null when there is no item in context", () => {
    expect(resolvePluginTarget(["chapter"], EMPTY_PLUGIN_ITEM_CONTEXT)).toBeNull();
    expect(resolvePluginTarget(["book", "chapter"], { ...EMPTY_PLUGIN_ITEM_CONTEXT })).toBeNull();
  });

  it("returns null for a kind the Command does not declare", () => {
    expect(resolvePluginTarget(["note"], { ...EMPTY_PLUGIN_ITEM_CONTEXT, chapter: "c1" })).toBeNull();
    expect(resolvePluginTarget([], full)).toBeNull();
    expect(resolvePluginTarget(undefined, full)).toBeNull();
  });
});

describe("pluginItemContextForPath", () => {
  it("maps the active route to the item the author is in", () => {
    expect(pluginItemContextForPath("/book/b1", { ...EMPTY_PLUGIN_ITEM_CONTEXT, chapter: "c1" }))
      .toEqual({ book: "b1", chapter: "c1", note: null, canvas: null, canvasNode: null });
    expect(pluginItemContextForPath("/book/b1/cover", EMPTY_PLUGIN_ITEM_CONTEXT)).toEqual({
      book: "b1",
      chapter: null,
      note: null,
      canvas: null,
      canvasNode: null,
    });
    expect(pluginItemContextForPath("/notes/n1", EMPTY_PLUGIN_ITEM_CONTEXT)).toEqual({
      book: null,
      chapter: null,
      note: "n1",
      canvas: null,
      canvasNode: null,
    });
    expect(
      pluginItemContextForPath("/canvas/v1", {
        ...EMPTY_PLUGIN_ITEM_CONTEXT,
        canvasNode: "node1",
      })
    ).toEqual({
      book: null,
      chapter: null,
      note: null,
      canvas: "v1",
      canvasNode: "node1",
    });
  });

  it("drops the kinds that do not belong to the active route", () => {
    // A Chapter stays open in the store after the author leaves the editor.
    expect(
      pluginItemContextForPath("/notes/n1", { ...EMPTY_PLUGIN_ITEM_CONTEXT, chapter: "c1" })
    ).toMatchObject({ chapter: null });
    // The Book list does not put the author on a Book.
    expect(pluginItemContextForPath("/", full)).toMatchObject({ book: null, chapter: null });
    expect(pluginItemContextForPath("/notes", full)).toMatchObject({ note: null, chapter: null });
    expect(pluginItemContextForPath("/canvas", full)).toMatchObject({
      canvas: null,
      canvasNode: null,
    });
    // No canvas node is selected.
    expect(pluginItemContextForPath("/canvas/v1", EMPTY_PLUGIN_ITEM_CONTEXT)).toMatchObject({
      canvas: "v1",
      canvasNode: null,
    });
  });
});
