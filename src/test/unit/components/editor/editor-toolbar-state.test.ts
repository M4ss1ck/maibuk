import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRichTextExtensions } from "@/components/editor/extensions/createRichTextExtensions";
import { getEditorToolbarState } from "@/components/editor/toolbar/editor-toolbar-state";

const editors: Editor[] = [];

function makeEditor(content = "<p>Hello world</p>"): Editor {
  const editor = new Editor({
    extensions: createRichTextExtensions(),
    content,
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  while (editors.length > 0) {
    editors.pop()?.destroy();
  }
  vi.restoreAllMocks();
});

describe("getEditorToolbarState", () => {
  it("returns the full snapshot with defaults", () => {
    const editor = makeEditor("<p>Hello</p>");
    const snapshot = getEditorToolbarState(editor);

    expect(snapshot.fontSize).toBe("18");
    expect(snapshot.lineHeight).toBe("1.5");
    expect(snapshot.fontFamily).toBe("Literata, serif");
    expect(snapshot.color).toBe("");
    expect(snapshot.highlightColor).toBe("");
    expect(snapshot.isBold).toBe(false);
    expect(snapshot.isH1).toBe(false);
    expect(snapshot.hasSelection).toBe(false);
    expect(snapshot).toHaveProperty("canUndo");
    expect(snapshot).toHaveProperty("canRedo");
    expect(snapshot).toHaveProperty("canSinkListItem");
    expect(snapshot).toHaveProperty("canLiftListItem");
  });

  it("returns the cached snapshot without repeating can()/attribute calculations for the same state", () => {
    const editor = makeEditor("<p>Hello</p>");
    const canSpy = vi.spyOn(editor, "can");
    const attrsSpy = vi.spyOn(editor, "getAttributes");
    const isActiveSpy = vi.spyOn(editor, "isActive");

    const first = getEditorToolbarState(editor);
    const canCallsAfterFirst = canSpy.mock.calls.length;
    const attrsCallsAfterFirst = attrsSpy.mock.calls.length;
    const isActiveCallsAfterFirst = isActiveSpy.mock.calls.length;
    expect(canCallsAfterFirst).toBeGreaterThan(0);

    const second = getEditorToolbarState(editor);

    expect(second).toBe(first);
    expect(canSpy.mock.calls.length).toBe(canCallsAfterFirst);
    expect(attrsSpy.mock.calls.length).toBe(attrsCallsAfterFirst);
    expect(isActiveSpy.mock.calls.length).toBe(isActiveCallsAfterFirst);
  });

  it("builds the command helper once per computed snapshot", () => {
    const editor = makeEditor("<p>Hello</p>");
    const canSpy = vi.spyOn(editor, "can");

    getEditorToolbarState(editor);
    getEditorToolbarState(editor);

    expect(canSpy).toHaveBeenCalledTimes(1);
  });

  it("refreshes the snapshot when stored marks change", () => {
    const editor = makeEditor("<p>Hello</p>");
    const before = getEditorToolbarState(editor);
    expect(before.isBold).toBe(false);

    editor.commands.toggleBold();
    expect(editor.state.selection.empty).toBe(true);
    expect(editor.state.storedMarks?.map((mark) => mark.type.name)).toContain("bold");
    const after = getEditorToolbarState(editor);

    expect(after).not.toBe(before);
    expect(after.isBold).toBe(true);
  });

  it("refreshes the snapshot when selection changes", () => {
    const editor = makeEditor("<p>Hello world</p>");
    editor.commands.setTextSelection(1);
    const collapsed = getEditorToolbarState(editor);
    expect(collapsed.hasSelection).toBe(false);

    editor.commands.setTextSelection({ from: 1, to: 6 });
    const expanded = getEditorToolbarState(editor);

    expect(expanded).not.toBe(collapsed);
    expect(expanded.hasSelection).toBe(true);
  });

  it("refreshes the snapshot on edit and undo/redo", () => {
    const editor = makeEditor("<p>Hello</p>");
    const initial = getEditorToolbarState(editor);
    expect(initial.canUndo).toBe(false);
    expect(initial.canRedo).toBe(false);

    editor.chain().focus().insertContent(" more").run();
    const edited = getEditorToolbarState(editor);
    expect(edited).not.toBe(initial);
    expect(edited.canUndo).toBe(true);

    editor.chain().focus().undo().run();
    const undone = getEditorToolbarState(editor);
    expect(undone).not.toBe(edited);
    expect(undone.canRedo).toBe(true);

    editor.chain().focus().redo().run();
    const redone = getEditorToolbarState(editor);
    expect(redone).not.toBe(undone);
    expect(redone.canUndo).toBe(true);
  });

  it("does not share cached results between separate editors", () => {
    const firstEditor = makeEditor("<p>First</p>");
    const secondEditor = makeEditor("<p>Second</p>");

    const firstSnapshot = getEditorToolbarState(firstEditor);
    const secondSnapshot = getEditorToolbarState(secondEditor);

    expect(secondSnapshot).not.toBe(firstSnapshot);

    firstEditor.chain().focus().selectAll().toggleBold().run();
    const firstAfterEdit = getEditorToolbarState(firstEditor);
    const secondAfterEdit = getEditorToolbarState(secondEditor);

    expect(firstAfterEdit.isBold).toBe(true);
    expect(secondAfterEdit.isBold).toBe(false);
    expect(secondAfterEdit).toBe(secondSnapshot);
  });
});
