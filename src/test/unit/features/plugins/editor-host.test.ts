import { Editor } from "@tiptap/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { createRichTextExtensions } from "@/components/editor/extensions/createRichTextExtensions";
import { buildPlainTextMap, plainRangeToPmRange, pmToPlainOffset } from "@/components/editor/plain-text-offsets";
import type { PluginEntityTarget } from "@/features/plugins/types";
import {
  EDITOR_CONTENT_EVENT_MS,
  clearPluginHighlights,
  flushPendingEditorReveal,
  getPluginEditorContent,
  getPluginEditorSelection,
  onEditorContentChanged,
  onEditorFocusChanged,
  registerPluginEditor,
  requestEditorReveal,
  resetPluginEditorHostForTests,
  revealInFocusedEditor,
  setPluginEditorHighlights,
} from "@/features/plugins/editor-host";

const editors: Editor[] = [];
let nextId = 0;

function mountEditor(content: string): Editor {
  const editor = new Editor({ extensions: createRichTextExtensions(), content });
  document.body.appendChild(editor.view.dom);
  editors.push(editor);
  return editor;
}

function register(editor: Editor, entity: PluginEntityTarget = { kind: "chapter", id: "c1" }): () => void {
  return registerPluginEditor({ id: `editor-${nextId++}`, editor, entity });
}

beforeEach(() => {
  resetPluginEditorHostForTests();
});

afterEach(() => {
  resetPluginEditorHostForTests();
  for (const editor of editors.splice(0)) {
    editor.view.dom.remove();
    editor.destroy();
  }
  vi.useRealTimers();
});

describe("the focused editor reads", () => {
  it("reports no target with no editor focused", () => {
    expect(getPluginEditorContent()).toEqual({ status: "no-target" });
    expect(getPluginEditorSelection()).toEqual({ status: "no-target" });
    expect(revealInFocusedEditor({ from: 0, to: 1 })).toEqual({ status: "no-target" });
    expect(setPluginEditorHighlights("a", { kind: "info", ranges: [] })).toEqual({
      status: "no-target",
    });
  });

  it("reads the focused editor's content and entity", () => {
    const editor = mountEditor("<p>Hello <strong>world</strong></p>");
    editor.view.dom.focus();
    register(editor, { kind: "chapter", id: "c1" });

    expect(getPluginEditorContent()).toEqual({
      status: "ok",
      entity: { kind: "chapter", id: "c1" },
      content: { text: "Hello world", html: "<p>Hello <strong>world</strong></p>" },
    });
  });

  it("reads the selection as plain-text offsets with its text", () => {
    const editor = mountEditor("<p>Hello world</p>");
    editor.view.dom.focus();
    register(editor, { kind: "note", id: "n1" });
    editor.commands.setTextSelection({ from: 1, to: 6 });

    expect(getPluginEditorSelection()).toEqual({
      status: "ok",
      entity: { kind: "note", id: "n1" },
      range: { from: 0, to: 5 },
      text: "Hello",
    });
  });

  it("reads selection offsets that slice back to the text a highlight covers", () => {
    const editor = mountEditor(
      "<p>Plain <strong>bold</strong> text</p><ul><li><p>item one</p></li></ul>"
    );
    editor.view.dom.focus();
    register(editor);
    const map = buildPlainTextMap(editor.state.doc);
    const expected = "bold text";
    const from = map.text.indexOf("bold");
    const to = from + expected.length;
    const pm = plainRangeToPmRange(map, from, to);
    if (pm === null) throw new Error("the sample range maps to no document range");
    editor.commands.setTextSelection({ from: pm.from, to: pm.to });

    expect(getPluginEditorSelection()).toEqual({
      status: "ok",
      entity: { kind: "chapter", id: "c1" },
      range: { from, to },
      text: expected,
    });

    setPluginEditorHighlights("a", { kind: "info", ranges: [{ from, to }] });
    // A range that crosses a mark renders as more than one inline span; the
    // union of them covers exactly the text the offsets name.
    const highlighted = [...editor.view.dom.querySelectorAll(".plugin-highlight--info")]
      .map((element) => element.textContent)
      .join("");
    expect(highlighted).toBe(expected);
  });

  it("prefers the last editor to take focus", () => {    const first = mountEditor("<p>First</p>");
    const second = mountEditor("<p>Second</p>");
    register(first, { kind: "chapter", id: "c1" });
    register(second, { kind: "chapter", id: "c2" });

    second.view.dom.focus();
    expect(getPluginEditorContent()).toMatchObject({ entity: { kind: "chapter", id: "c2" } });
    first.view.dom.focus();
    expect(getPluginEditorContent()).toMatchObject({ entity: { kind: "chapter", id: "c1" } });
  });
});

describe("editor highlights", () => {
  it("keeps two Plugins' highlights and clears only the disabled one", () => {
    const editor = mountEditor("<p>one two three four</p>");
    editor.view.dom.focus();
    register(editor);

    expect(setPluginEditorHighlights("a", { kind: "info", ranges: [{ from: 0, to: 3 }] })).toEqual({
      status: "applied",
    });
    expect(
      setPluginEditorHighlights("b", { kind: "warning", ranges: [{ from: 4, to: 7 }] })
    ).toEqual({ status: "applied" });

    expect(editor.view.dom.querySelectorAll(".plugin-highlight--info")).toHaveLength(1);
    expect(editor.view.dom.querySelectorAll(".plugin-highlight--warning")).toHaveLength(1);
    expect(editor.view.dom.querySelector(".plugin-highlight--info")?.textContent).toBe("one");
    expect(editor.view.dom.querySelector(".plugin-highlight--warning")?.textContent).toBe("two");

    clearPluginHighlights("a");

    expect(editor.view.dom.querySelectorAll(".plugin-highlight--info")).toHaveLength(0);
    expect(editor.view.dom.querySelectorAll(".plugin-highlight--warning")).toHaveLength(1);
  });

  it("replaces a Plugin's whole set on every call", () => {
    const editor = mountEditor("<p>one two three four</p>");
    editor.view.dom.focus();
    register(editor);

    setPluginEditorHighlights("a", { kind: "info", ranges: [{ from: 0, to: 3 }] });
    setPluginEditorHighlights("a", {
      kind: "repetition",
      ranges: [{ from: 4, to: 7, label: "again" }],
    });

    expect(editor.view.dom.querySelectorAll(".plugin-highlight--info")).toHaveLength(0);
    expect(editor.view.dom.querySelectorAll(".plugin-highlight--repetition")).toHaveLength(1);
    expect(
      editor.view.dom
        .querySelector(".plugin-highlight--repetition")
        ?.getAttribute("data-plugin-highlight-label")
    ).toBe("again");
  });

  it("repaints the same offsets through local edits", () => {
    const editor = mountEditor("<p>one two</p>");
    editor.view.dom.focus();
    register(editor);
    setPluginEditorHighlights("a", { kind: "info", ranges: [{ from: 0, to: 3 }] });

    editor.commands.insertContentAt(1, "X");

    const map = buildPlainTextMap(editor.state.doc);
    expect(editor.view.dom.querySelector(".plugin-highlight--info")?.textContent).toBe(
      map.text.slice(0, 3)
    );
  });

  it("never becomes saved formatting", () => {
    const editor = mountEditor("<p>one two</p>");
    editor.view.dom.focus();
    register(editor);
    const before = editor.getHTML();

    setPluginEditorHighlights("a", { kind: "info", ranges: [{ from: 0, to: 3 }] });

    expect(editor.getHTML()).toBe(before);
    expect(editor.getHTML()).not.toContain("plugin-highlight");

    const reopened = mountEditor(editor.getHTML());
    expect(reopened.view.dom.querySelectorAll(".plugin-highlight")).toHaveLength(0);
    expect(reopened.getText()).toBe("one two");
  });
});

describe("editor reveal", () => {
  it("places the caret at the offset", () => {
    const editor = mountEditor("<p>one two three</p>");
    editor.view.dom.focus();
    register(editor);

    expect(revealInFocusedEditor({ from: 4, to: 7 })).toEqual({ status: "applied" });

    const map = buildPlainTextMap(editor.state.doc);
    expect(editor.state.selection.empty).toBe(true);
    expect(pmToPlainOffset(map, editor.state.selection.from)).toBe(4);
  });

  it("leaves the caret where the next keystroke lands", async () => {
    const user = userEvent.setup();
    const editor = mountEditor("<p>one two three</p>");
    editor.view.dom.focus();
    register(editor);

    revealInFocusedEditor({ from: 4, to: 7 });
    await user.keyboard("X");

    expect(editor.getText()).toBe("one Xtwo three");
  });

  it("applies a reveal queued for an entity before its editor mounts", () => {
    requestEditorReveal({ kind: "chapter", id: "c9" }, { from: 4, to: 7 });

    const editor = mountEditor("<p>one two three</p>");
    editor.view.dom.focus();
    register(editor, { kind: "chapter", id: "c9" });

    const map = buildPlainTextMap(editor.state.doc);
    expect(pmToPlainOffset(map, editor.state.selection.from)).toBe(4);
  });

  it("flushes a reveal queued while the editor was behind a modal", () => {
    const editor = mountEditor("<p>one two three</p>");
    editor.view.dom.focus();
    const id = `editor-${nextId++}`;
    registerPluginEditor({ id, editor, entity: { kind: "chapter", id: "c1" } });

    // Behind a modal the editor is not a target, so the reveal is queued.
    const modal = document.createElement("div");
    modal.setAttribute("aria-hidden", "true");
    document.body.appendChild(modal);
    modal.appendChild(editor.view.dom);
    requestEditorReveal({ kind: "chapter", id: "c1" }, { from: 4, to: 7 });

    document.body.appendChild(editor.view.dom);
    modal.remove();
    flushPendingEditorReveal(id);

    const map = buildPlainTextMap(editor.state.doc);
    expect(pmToPlainOffset(map, editor.state.selection.from)).toBe(4);
  });
});

describe("editor events", () => {
  it("coalesces content changes into one event per burst", () => {
    vi.useFakeTimers();
    const editor = mountEditor("<p>one</p>");
    editor.view.dom.focus();
    register(editor);
    const seen = vi.fn();
    const off = onEditorContentChanged(seen);

    editor.commands.insertContentAt(4, " two");
    editor.commands.insertContentAt(8, " three");
    expect(seen).not.toHaveBeenCalled();

    vi.advanceTimersByTime(EDITOR_CONTENT_EVENT_MS);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen).toHaveBeenCalledWith({ kind: "chapter", id: "c1" });
    off();
  });

  it("reports focus changes, including none", () => {
    vi.useFakeTimers();
    const editor = mountEditor("<p>one</p>");
    const seen = vi.fn();
    const off = onEditorFocusChanged(seen);

    editor.view.dom.focus();
    register(editor);
    expect(seen).toHaveBeenLastCalledWith({ kind: "chapter", id: "c1" });

    editor.view.dom.blur();
    vi.advanceTimersByTime(0);
    expect(seen).toHaveBeenLastCalledWith(null);
    off();
  });
});
