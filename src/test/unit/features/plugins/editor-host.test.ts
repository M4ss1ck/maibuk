import { Editor } from "@tiptap/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRichTextExtensions } from "@/components/editor/extensions/createRichTextExtensions";
import {
  buildPlainTextMap,
  plainRangeToPmRange,
  pmToPlainOffset,
} from "@/components/editor/plain-text-offsets";
import * as plainTextOffsets from "@/components/editor/plain-text-offsets";
import type { PluginEditorEntity } from "@/features/plugins/types";
import {
  EDITOR_CONTENT_EVENT_MS,
  pluginEditorTargetKey,
  setPluginEditorLanguage,
  PENDING_REVEAL_TTL_MS,
  clearPluginHighlights,
  flushPendingEditorReveal,
  getPluginEditorContent,
  getPluginEditorSelection,
  insertInFocusedEditor,
  invalidatePluginEditorWork,
  onEditorContentChanged,
  onEditorFocusChanged,
  registerPluginEditor,
  replaceInFocusedEditor,
  requestEditorReveal,
  resetPluginEditorHostForTests,
  revealInFocusedEditor,
  setPluginEditorHighlights,
} from "@/features/plugins/editor-host";
import { longChapterHtml, spreadHighlightRanges } from "@/test/support/long-chapter";
import { PluginApiError } from "@/plugin-sdk/protocol";
import { PLUGIN_API_TABLE } from "@/features/plugins/api-table";

const editors: Editor[] = [];
let nextId = 0;

function mountEditor(content: string): Editor {
  const editor = new Editor({ extensions: createRichTextExtensions(), content });
  document.body.appendChild(editor.view.dom);
  editors.push(editor);
  return editor;
}

function register(
  editor: Editor,
  entity: PluginEditorEntity = { kind: "chapter", id: "c1" },
  language = "en"
): () => void {
  return registerPluginEditor({ id: `editor-${nextId++}`, editor, entity, language });
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
  vi.restoreAllMocks();
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
      language: "en",
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

  it("prefers the last editor to take focus", () => {
    const first = mountEditor("<p>First</p>");
    const second = mountEditor("<p>Second</p>");
    register(first, { kind: "chapter", id: "c1" });
    register(second, { kind: "chapter", id: "c2" });

    second.view.dom.focus();
    expect(getPluginEditorContent()).toMatchObject({ entity: { kind: "chapter", id: "c2" } });
    first.view.dom.focus();
    expect(getPluginEditorContent()).toMatchObject({ entity: { kind: "chapter", id: "c1" } });
  });

  it("reports focusChanged to another editor's entity when another takes focus", () => {
    const seen = vi.fn();
    const first = mountEditor("<p>First</p>");
    const second = mountEditor("<p>Second</p>");
    first.view.dom.focus();
    register(first, { kind: "chapter", id: "c1" });
    const off = onEditorFocusChanged(seen);

    second.view.dom.focus();
    register(second, { kind: "chapter", id: "c2" });

    expect(seen).toHaveBeenLastCalledWith({ kind: "chapter", id: "c2" });
    off();
  });

  it("keeps addressing the last focused editor after focus moves to a button", () => {
    vi.useFakeTimers();
    const editor = mountEditor("<p>one two</p>");
    editor.view.dom.focus();
    register(editor);
    const seen = vi.fn();
    const off = onEditorFocusChanged(seen);

    // A Plugin toolbar button (or any control outside the editor) takes focus.
    const button = document.createElement("button");
    button.type = "button";
    document.body.appendChild(button);
    button.focus();
    vi.advanceTimersByTime(0);
    expect(document.activeElement).toBe(button);

    expect(getPluginEditorSelection()).toMatchObject({
      status: "ok",
      entity: { kind: "chapter", id: "c1" },
    });
    expect(setPluginEditorHighlights("a", { kind: "info", ranges: [{ from: 0, to: 3 }] })).toEqual({
      status: "applied",
    });
    expect(revealInFocusedEditor({ from: 0, to: 3 })).toEqual({ status: "applied" });
    // Blur alone never clears the target.
    expect(seen).not.toHaveBeenCalledWith(null);
    button.remove();
    off();
  });

  it("serves editor.getSelection when a Plugin toolbar button holds focus", () => {
    vi.useFakeTimers();
    const editor = mountEditor("<p>one two</p>");
    editor.view.dom.focus();
    const id = `editor-${nextId++}`;
    registerPluginEditor({ id, editor, entity: { kind: "chapter", id: "c1" }, language: "en" });

    // The toolbar button a Plugin command runs from is outside the editor.
    const button = document.createElement("button");
    button.type = "button";
    document.body.appendChild(button);
    button.focus();
    vi.advanceTimersByTime(0);

    expect(getPluginEditorSelection()).toMatchObject({
      status: "ok",
      entity: { kind: "chapter", id: "c1" },
    });
    button.remove();
  });

  it("reports no target after the focused editor unmounts, with focusChanged(null)", () => {
    vi.useFakeTimers();
    const editor = mountEditor("<p>one two</p>");
    editor.view.dom.focus();
    const seen = vi.fn();
    const off = onEditorFocusChanged(seen);
    const dispose = register(editor);
    expect(seen).toHaveBeenLastCalledWith({ kind: "chapter", id: "c1" });

    dispose();

    expect(getPluginEditorSelection()).toEqual({ status: "no-target" });
    expect(setPluginEditorHighlights("a", { kind: "info", ranges: [] })).toEqual({
      status: "no-target",
    });
    vi.advanceTimersByTime(0);
    expect(seen).toHaveBeenLastCalledWith(null);
    off();
  });

  it("ignores an editor behind an open modal", () => {
    const editor = mountEditor("<p>one two</p>");
    editor.view.dom.focus();
    register(editor);

    const modal = document.createElement("div");
    modal.setAttribute("aria-hidden", "true");
    document.body.appendChild(modal);
    modal.appendChild(editor.view.dom);

    expect(getPluginEditorSelection()).toEqual({ status: "no-target" });
    expect(setPluginEditorHighlights("a", { kind: "info", ranges: [{ from: 0, to: 3 }] })).toEqual({
      status: "no-target",
    });

    document.body.appendChild(editor.view.dom);
    modal.remove();
  });
});

describe("the only editor on screen", () => {
  it("is the target before the author ever puts the caret in it", () => {
    // Opening an existing Note and going straight to a toolbar button never
    // focuses its editor; the editor on screen is still the one to address.
    const editor = mountEditor("<p>The door opened. The door closed.</p>");
    register(editor, { kind: "note", id: "n1" });

    expect(editor.isFocused).toBe(false);
    expect(getPluginEditorContent()).toMatchObject({
      status: "ok",
      entity: { kind: "note", id: "n1" },
    });
    expect(getPluginEditorSelection()).toMatchObject({ status: "ok" });
    expect(setPluginEditorHighlights("a", { kind: "info", ranges: [{ from: 4, to: 8 }] })).toEqual({
      status: "applied",
    });
    expect(revealInFocusedEditor({ from: 0, to: 3 })).toEqual({ status: "applied" });
  });

  it("is announced as the target when it registers, and none once it unmounts", () => {
    vi.useFakeTimers();
    const seen = vi.fn();
    const off = onEditorFocusChanged(seen);
    const editor = mountEditor("<p>one</p>");

    const dispose = register(editor, { kind: "note", id: "n1" });
    expect(seen).toHaveBeenLastCalledWith({ kind: "note", id: "n1" });
    expect(pluginEditorTargetKey()).toBe("note:n1");

    dispose();
    vi.advanceTimersByTime(0);
    expect(seen).toHaveBeenLastCalledWith(null);
    expect(pluginEditorTargetKey()).toBeNull();
    off();
  });

  it("is no target when two editors are on screen and neither has had focus", () => {
    register(mountEditor("<p>First</p>"), { kind: "chapter", id: "c1" });
    register(mountEditor("<p>Second</p>"), { kind: "note", id: "n1" });

    expect(getPluginEditorContent()).toEqual({ status: "no-target" });
    expect(pluginEditorTargetKey()).toBeNull();
  });

  it("is no target while it sits behind a modal", () => {
    const editor = mountEditor("<p>one two</p>");
    register(editor);
    const modal = document.createElement("div");
    modal.setAttribute("aria-hidden", "true");
    document.body.appendChild(modal);
    modal.appendChild(editor.view.dom);

    expect(getPluginEditorContent()).toEqual({ status: "no-target" });

    document.body.appendChild(editor.view.dom);
    modal.remove();
  });

  it("serves the Ephemeral, which has no Library row", () => {
    const editor = mountEditor("<p>scratch words</p>");
    register(editor, { kind: "ephemeral", id: "ephemeral" }, "es");

    expect(getPluginEditorContent()).toEqual({
      status: "ok",
      entity: { kind: "ephemeral", id: "ephemeral" },
      language: "es",
      content: { text: "scratch words", html: "<p>scratch words</p>" },
    });
  });
});

describe("the editor's language", () => {
  it("is read with the content", () => {
    const editor = mountEditor("<p>hola</p>");
    editor.view.dom.focus();
    register(editor, { kind: "note", id: "n1" }, "es");

    expect(getPluginEditorContent()).toMatchObject({ status: "ok", language: "es" });
  });

  it("changing is a content change, and setting the same language is not", () => {
    vi.useFakeTimers();
    const editor = mountEditor("<p>hola</p>");
    editor.view.dom.focus();
    const id = `editor-${nextId++}`;
    registerPluginEditor({ id, editor, entity: { kind: "note", id: "n1" }, language: "en" });
    const changed = vi.fn();
    const off = onEditorContentChanged(changed);

    setPluginEditorLanguage(id, "en");
    vi.advanceTimersByTime(EDITOR_CONTENT_EVENT_MS);
    expect(changed).not.toHaveBeenCalled();

    setPluginEditorLanguage(id, "es");
    expect(getPluginEditorContent()).toMatchObject({ language: "es" });
    vi.advanceTimersByTime(EDITOR_CONTENT_EVENT_MS);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenLastCalledWith({ kind: "note", id: "n1" });
    off();
  });

  it("ignores a language set for an editor that is not registered", () => {
    expect(() => setPluginEditorLanguage("missing", "es")).not.toThrow();
  });
});

describe("re-registering the same editor id", () => {
  it("keeps the target and emits one focusChanged with the new entity", () => {
    const editor = mountEditor("<p>one</p>");
    editor.view.dom.focus();
    const seen = vi.fn();
    const off = onEditorFocusChanged(seen);
    registerPluginEditor({ id: "note-editor", editor, entity: { kind: "note", id: "n1" }, language: "en" });
    seen.mockClear();

    // A Note switch re-registers the same editor instance and id.
    registerPluginEditor({ id: "note-editor", editor, entity: { kind: "note", id: "n2" }, language: "en" });

    expect(seen).not.toHaveBeenCalledWith(null);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen).toHaveBeenLastCalledWith({ kind: "note", id: "n2" });
    expect(getPluginEditorContent()).toMatchObject({
      status: "ok",
      entity: { kind: "note", id: "n2" },
    });
    off();
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

  it("keeps overlapping highlights from two Plugins individually discoverable", () => {
    const editor = mountEditor("<p>one two</p>");
    editor.view.dom.focus();
    register(editor);

    setPluginEditorHighlights("a", { kind: "info", ranges: [{ from: 0, to: 3, label: "A" }] });
    setPluginEditorHighlights("b", {
      kind: "repetition",
      ranges: [{ from: 0, to: 3, label: "B" }],
    });

    const marks = within(editor.view.dom).getAllByRole("mark");
    expect(marks).toHaveLength(2);
    const byPlugin = new Map(
      marks.map((mark) => [mark.getAttribute("data-plugin-highlight"), mark])
    );
    const a = byPlugin.get("a");
    const b = byPlugin.get("b");
    expect(a).toHaveAttribute("aria-description", "A");
    expect(b).toHaveAttribute("aria-description", "B");
    expect(a).toHaveTextContent("one");
    expect(b).toHaveTextContent("one");

    clearPluginHighlights("a");

    const remaining = within(editor.view.dom).getAllByRole("mark");
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toHaveAttribute("data-plugin-highlight", "b");
    expect(remaining[0]).toHaveTextContent("one");
  });

  it("renders two kinds from one Plugin at the same time", () => {
    const editor = mountEditor("<p>one two three four</p>");
    editor.view.dom.focus();
    register(editor);

    setPluginEditorHighlights("a", { kind: "info", ranges: [{ from: 0, to: 3 }] });
    setPluginEditorHighlights("a", {
      kind: "repetition",
      ranges: [{ from: 4, to: 7, label: "again" }],
    });

    expect(editor.view.dom.querySelectorAll(".plugin-highlight--info")).toHaveLength(1);
    expect(editor.view.dom.querySelectorAll(".plugin-highlight--repetition")).toHaveLength(1);
    expect(editor.view.dom.querySelector(".plugin-highlight--info")?.textContent).toBe("one");
    expect(editor.view.dom.querySelector(".plugin-highlight--repetition")?.textContent).toBe("two");
    expect(
      editor.view.dom
        .querySelector(".plugin-highlight--repetition")
        ?.getAttribute("data-plugin-highlight-label")
    ).toBe("again");
  });

  it("replaces only the kind being set and keeps the Plugin's other kinds", () => {
    const editor = mountEditor("<p>one two three four</p>");
    editor.view.dom.focus();
    register(editor);

    setPluginEditorHighlights("a", { kind: "info", ranges: [{ from: 0, to: 3 }] });
    setPluginEditorHighlights("a", { kind: "warning", ranges: [{ from: 4, to: 7 }] });

    // Replacing the info kind moves it; the warning kind stays put.
    setPluginEditorHighlights("a", { kind: "info", ranges: [{ from: 14, to: 18 }] });

    expect(editor.view.dom.querySelectorAll(".plugin-highlight--info")).toHaveLength(1);
    expect(editor.view.dom.querySelector(".plugin-highlight--info")?.textContent).toBe("four");
    expect(editor.view.dom.querySelectorAll(".plugin-highlight--warning")).toHaveLength(1);
    expect(editor.view.dom.querySelector(".plugin-highlight--warning")?.textContent).toBe("two");
  });

  it("clears only the kind whose ranges are empty", () => {
    const editor = mountEditor("<p>one two three four</p>");
    editor.view.dom.focus();
    register(editor);

    setPluginEditorHighlights("a", { kind: "info", ranges: [{ from: 0, to: 3 }] });
    setPluginEditorHighlights("a", { kind: "warning", ranges: [{ from: 4, to: 7 }] });

    setPluginEditorHighlights("a", { kind: "info", ranges: [] });

    expect(editor.view.dom.querySelectorAll(".plugin-highlight--info")).toHaveLength(0);
    expect(editor.view.dom.querySelectorAll(".plugin-highlight--warning")).toHaveLength(1);
    expect(editor.view.dom.querySelector(".plugin-highlight--warning")?.textContent).toBe("two");
  });

  it("clears every kind of one Plugin and leaves another Plugin untouched", () => {
    const editor = mountEditor("<p>one two three four</p>");
    editor.view.dom.focus();
    register(editor);

    setPluginEditorHighlights("a", { kind: "info", ranges: [{ from: 0, to: 3 }] });
    setPluginEditorHighlights("a", { kind: "repetition", ranges: [{ from: 4, to: 7 }] });
    setPluginEditorHighlights("b", { kind: "warning", ranges: [{ from: 14, to: 18 }] });

    clearPluginHighlights("a");

    expect(editor.view.dom.querySelectorAll(".plugin-highlight--info")).toHaveLength(0);
    expect(editor.view.dom.querySelectorAll(".plugin-highlight--repetition")).toHaveLength(0);
    expect(editor.view.dom.querySelectorAll(".plugin-highlight--warning")).toHaveLength(1);
    expect(editor.view.dom.querySelector(".plugin-highlight--warning")?.textContent).toBe("four");
  });

  it("keeps a highlight on the same word when typing before it", () => {
    const editor = mountEditor("<p>one two</p>");
    editor.view.dom.focus();
    register(editor);
    setPluginEditorHighlights("a", { kind: "info", ranges: [{ from: 4, to: 7 }] });
    expect(editor.view.dom.querySelector(".plugin-highlight--info")?.textContent).toBe("two");

    editor.commands.insertContentAt(1, "X");

    expect(editor.getText()).toBe("Xone two");
    expect(editor.view.dom.querySelector(".plugin-highlight--info")?.textContent).toBe("two");
  });

  it("exposes a labelled highlight as a mark with its description", () => {
    const editor = mountEditor("<p>one two</p>");
    editor.view.dom.focus();
    register(editor);

    setPluginEditorHighlights("a", {
      kind: "repetition",
      ranges: [{ from: 4, to: 7, label: "again" }],
    });

    const mark = screen.getByRole("mark");
    expect(mark).toHaveTextContent("two");
    expect(mark).toHaveAccessibleDescription("again");
    expect(mark).toHaveAttribute("data-plugin-highlight-label", "again");
  });

  it("maps highlights without rebuilding them on a keystroke in a long Chapter", () => {
    const editor = mountEditor(longChapterHtml());
    editor.view.dom.focus();
    register(editor);
    const map = buildPlainTextMap(editor.state.doc);
    const ranges = spreadHighlightRanges(map.text);
    const spy = vi.spyOn(plainTextOffsets, "buildPlainTextMap");

    setPluginEditorHighlights("a", { kind: "info", ranges });
    // The set meta walks the document once to build the decorations.
    expect(spy).toHaveBeenCalledTimes(1);

    editor.commands.insertContentAt(1, "X");

    // A keystroke maps the stored decorations; it never walks the text again.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(editor.view.dom.querySelectorAll(".plugin-highlight--info").length).toBeGreaterThan(0);
  });

  it("walks the document once per doc and again only when the doc changes", () => {
    const editor = mountEditor("<p>one two three four</p>");
    editor.view.dom.focus();
    register(editor);
    const spy = vi.spyOn(plainTextOffsets, "buildPlainTextMap");

    setPluginEditorHighlights("a", { kind: "info", ranges: [{ from: 0, to: 3 }] });
    expect(spy).toHaveBeenCalledTimes(1);

    // A second kind on the same doc reuses the cached plain-text map.
    setPluginEditorHighlights("a", { kind: "warning", ranges: [{ from: 4, to: 7 }] });
    expect(spy).toHaveBeenCalledTimes(1);

    // The edit makes a new doc node, so the next set rebuilds the map.
    editor.commands.insertContentAt(1, "X");
    setPluginEditorHighlights("a", { kind: "repetition", ranges: [{ from: 5, to: 8 }] });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(
      editor.view.dom.querySelectorAll(".plugin-highlight--repetition").length
    ).toBeGreaterThan(0);
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

  it("drops a queued reveal that goes stale before it is consumed", () => {
    vi.useFakeTimers();
    requestEditorReveal({ kind: "chapter", id: "c9" }, { from: 4, to: 7 });
    vi.advanceTimersByTime(PENDING_REVEAL_TTL_MS + 1);

    const editor = mountEditor("<p>one two three</p>");
    editor.view.dom.focus();
    register(editor, { kind: "chapter", id: "c9" });

    const map = buildPlainTextMap(editor.state.doc);
    expect(pmToPlainOffset(map, editor.state.selection.from)).toBe(0);
  });

  it("flushes a reveal queued while the editor was behind a modal", () => {
    const editor = mountEditor("<p>one two three</p>");
    editor.view.dom.focus();
    const id = `editor-${nextId++}`;
    registerPluginEditor({ id, editor, entity: { kind: "chapter", id: "c1" }, language: "en" });

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

  it("does not report a focus change when the editor blurs", () => {
    vi.useFakeTimers();
    const editor = mountEditor("<p>one</p>");
    const seen = vi.fn();
    const off = onEditorFocusChanged(seen);

    editor.view.dom.focus();
    register(editor);
    expect(seen).toHaveBeenLastCalledWith({ kind: "chapter", id: "c1" });
    seen.mockClear();

    editor.view.dom.blur();
    vi.advanceTimersByTime(0);
    expect(seen).not.toHaveBeenCalled();
    off();
  });
});

describe("invalidating editor work at a Library boundary", () => {
  it("clears every Plugin's highlights from an open editor", () => {
    const editor = mountEditor("<p>one two three four</p>");
    editor.view.dom.focus();
    register(editor, { kind: "chapter", id: "c1" });

    setPluginEditorHighlights("a", { kind: "info", ranges: [{ from: 0, to: 3 }] });
    setPluginEditorHighlights("b", { kind: "warning", ranges: [{ from: 4, to: 7 }] });
    expect(editor.view.dom.querySelectorAll(".plugin-highlight")).toHaveLength(2);

    invalidatePluginEditorWork();

    expect(editor.view.dom.querySelectorAll(".plugin-highlight")).toHaveLength(0);
  });

  it("drops a reveal queued for an editor that has not mounted yet", () => {
    requestEditorReveal({ kind: "chapter", id: "c9" }, { from: 4, to: 7 });

    invalidatePluginEditorWork();

    const editor = mountEditor("<p>one two three</p>");
    editor.view.dom.focus();
    register(editor, { kind: "chapter", id: "c9" });

    const map = buildPlainTextMap(editor.state.doc);
    expect(pmToPlainOffset(map, editor.state.selection.from)).toBe(0);
  });

  it("cancels a content-changed event already queued for delivery", () => {
    vi.useFakeTimers();
    const editor = mountEditor("<p>one</p>");
    editor.view.dom.focus();
    register(editor);
    const seen = vi.fn();
    const off = onEditorContentChanged(seen);

    editor.commands.insertContentAt(4, " two");
    invalidatePluginEditorWork();
    vi.advanceTimersByTime(EDITOR_CONTENT_EVENT_MS);

    expect(seen).not.toHaveBeenCalled();
    off();
  });
});

describe("editor writes", () => {
  let nextWriteId = 0;

  function focusedEditor(content = "<p>Hello world</p>"): Editor {
    const editor = mountEditor(content);
    editor.view.dom.focus();
    registerPluginEditor({
      id: `write-editor-${nextWriteId++}`,
      editor,
      entity: { kind: "chapter", id: "c1" },
      language: "en",
    });
    return editor;
  }

  function caretAtEnd(editor: Editor): void {
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  }

  function refusal(run: () => unknown): PluginApiError {
    try {
      run();
    } catch (error) {
      return error as PluginApiError;
    }
    throw new Error("expected the call to be refused");
  }

  it("inserts {text} at the caret", () => {
    const editor = focusedEditor();
    caretAtEnd(editor);

    expect(insertInFocusedEditor({ text: "!" })).toEqual({ status: "applied" });
    expect(editor.getText()).toBe("Hello world!");
  });

  it("inserts {text} over a non-empty selection", () => {
    const editor = focusedEditor();
    editor.commands.setTextSelection({ from: 1, to: 6 });

    expect(insertInFocusedEditor({ text: "Goodbye" })).toEqual({ status: "applied" });
    expect(editor.getText()).toBe("Goodbye world");
  });

  it("keeps newlines and blank lines when inserting {text}", () => {
    const editor = focusedEditor("<p></p>");

    insertInFocusedEditor({ text: "one\ntwo\n\nthree" });

    // Round trip: the text reads back exactly as it went in.
    expect(editor.getText()).toBe("one\ntwo\n\nthree");
    expect(getPluginEditorContent()).toMatchObject({
      status: "ok",
      content: { text: "one\ntwo\n\nthree" },
    });
  });

  it("replaces a plain-text range with {text}, exactly", () => {
    const editor = focusedEditor();

    expect(replaceInFocusedEditor({ from: 6, to: 11 }, { text: "there" })).toEqual({
      status: "applied",
    });
    expect(editor.getText()).toBe("Hello there");
  });

  it("inserts {html} through the schema, keeping allowed formatting", () => {
    const editor = focusedEditor("<p></p>");

    expect(insertInFocusedEditor({ html: "<p>Hello <strong>bold</strong></p>" })).toEqual({
      status: "applied",
    });
    expect(editor.getHTML()).toContain("<strong>bold</strong>");
    expect(editor.getText()).toBe("Hello bold");
  });

  it("strips scripts, event handlers, and javascript: hrefs from {html}", () => {
    const editor = focusedEditor("<p></p>");

    insertInFocusedEditor({
      html: '<p>ok<script>alert(1)</script><span onclick="x()">world</span><a href="javascript:alert(1)">link</a></p>',
    });

    const html = editor.getHTML();
    expect(html).toContain("ok");
    expect(html).toContain("world");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("javascript:");
  });

  it("writes into the only editor on screen, never focused, at its selection, undoable in one step", () => {
    // The target rule (ADR 0030) covers writes too: an existing Note opened and
    // never clicked into takes an insert at its stored selection.
    const editor = mountEditor("<p>Hello world</p>");
    registerPluginEditor({
      id: `write-editor-${nextWriteId++}`,
      editor,
      entity: { kind: "note", id: "n1" },
      language: "en",
    });
    expect(editor.isFocused).toBe(false);
    const before = editor.getHTML();
    caretAtEnd(editor);

    expect(insertInFocusedEditor({ text: "!" })).toEqual({ status: "applied" });
    expect(replaceInFocusedEditor({ from: 0, to: 5 }, { text: "Howdy" })).toEqual({
      status: "applied",
    });
    expect(editor.getText()).toBe("Howdy world!");

    editor.commands.undo();
    expect(editor.getText()).toBe("Hello world!");
    editor.commands.undo();
    expect(editor.getHTML()).toBe(before);
  });

  it("undoes an insert in one step", () => {
    const editor = focusedEditor();
    const before = editor.getHTML();
    caretAtEnd(editor);

    insertInFocusedEditor({ text: "!" });
    expect(editor.getText()).toBe("Hello world!");

    editor.commands.undo();
    expect(editor.getHTML()).toBe(before);
    expect(editor.getText()).toBe("Hello world");
  });

  it("undoes a replace in one step", () => {
    const editor = focusedEditor();
    const before = editor.getHTML();

    replaceInFocusedEditor({ from: 6, to: 11 }, { text: "there" });
    expect(editor.getText()).toBe("Hello there");

    editor.commands.undo();
    expect(editor.getHTML()).toBe(before);
    expect(editor.getText()).toBe("Hello world");
  });

  it("keeps a Plugin insert as its own undo step between the author's typing", async () => {
    const user = userEvent.setup();
    const editor = focusedEditor("<p>Hello</p>");
    caretAtEnd(editor);

    await user.keyboard("a");
    expect(editor.getText()).toBe("Helloa");

    insertInFocusedEditor({ text: "Z" });
    expect(editor.getText()).toBe("HelloaZ");

    await user.keyboard("b");
    expect(editor.getText()).toBe("HelloaZb");

    // The first undo removes only the second typing.
    editor.commands.undo();
    expect(editor.getText()).toBe("HelloaZ");
    // The second undo removes exactly the Plugin insert.
    editor.commands.undo();
    expect(editor.getText()).toBe("Helloa");
    // The third removes the author's first keystroke.
    editor.commands.undo();
    expect(editor.getText()).toBe("Hello");
  });

  it("reports no target, and changes nothing, with no focused editor", () => {
    resetPluginEditorHostForTests();

    expect(insertInFocusedEditor({ text: "x" })).toEqual({ status: "no-target" });
    expect(replaceInFocusedEditor({ from: 0, to: 1 }, { text: "x" })).toEqual({
      status: "no-target",
    });
  });

  it("refuses an out-of-range replace, leaving the document unchanged", () => {
    const editor = focusedEditor("<p>Hello</p>");
    const before = editor.getHTML();

    const pastEnd = refusal(() => replaceInFocusedEditor({ from: 3, to: 99 }, { text: "x" }));
    expect(pastEnd).toBeInstanceOf(PluginApiError);
    expect(pastEnd.code).toBe("invalid-params");

    const reversed = refusal(() => replaceInFocusedEditor({ from: 4, to: 2 }, { text: "x" }));
    expect(reversed.code).toBe("invalid-params");

    expect(editor.getHTML()).toBe(before);
  });

  it("edits the editor it resolved even when focus moves to another during the call", () => {
    const first = mountEditor("<p>Alpha</p>");
    const second = mountEditor("<p>Beta</p>");
    registerPluginEditor({ id: "a", editor: first, entity: { kind: "chapter", id: "c1" }, language: "en" });
    registerPluginEditor({ id: "b", editor: second, entity: { kind: "chapter", id: "c2" }, language: "en" });
    first.view.dom.focus();
    const secondBefore = second.getHTML();
    // The edit's own update moves focus to the other editor mid-call.
    first.on("update", () => second.view.dom.focus());
    caretAtEnd(first);

    insertInFocusedEditor({ text: "!" });

    expect(first.getText()).toBe("Alpha!");
    expect(second.getHTML()).toBe(secondBefore);
  });
});

describe("colored highlight ranges (#532)", () => {
  function markFor(editor: Editor, kind: string): HTMLElement {
    const mark = editor.view.dom.querySelector<HTMLElement>(`.plugin-highlight--${kind}`);
    if (!mark) throw new Error(`no ${kind} highlight painted`);
    return mark;
  }

  it("paints a colored range's tint and underline in its color and keeps the kind's class", () => {
    const editor = mountEditor("<p>one two three</p>");
    editor.view.dom.focus();
    register(editor);

    setPluginEditorHighlights("echoes", {
      kind: "repetition",
      ranges: [{ from: 0, to: 3, color: "#0072b2" }],
    });

    const mark = markFor(editor, "repetition");
    expect(mark.classList.contains("plugin-highlight")).toBe(true);
    expect(mark.style.backgroundColor).toBe(
      "color-mix(in srgb, rgb(0, 114, 178) 22%, transparent)"
    );
    expect(mark.style.textDecorationColor).toBe("rgb(0, 114, 178)");
    // Text color is never set by a range color.
    expect(mark.style.color).toBe("");
  });

  it("leaves the kind's underline to the stylesheet on a colored info range", () => {
    const editor = mountEditor("<p>one two</p>");
    editor.view.dom.focus();
    register(editor);

    setPluginEditorHighlights("echoes", {
      kind: "info",
      ranges: [{ from: 0, to: 3, color: "#E69F00" }],
    });

    const mark = markFor(editor, "info");
    // The underline style and offset come from the kind's CSS rule; the inline
    // style only sets the color of that underline.
    expect(mark.style.textDecorationLine).toBe("");
    expect(mark.style.textDecorationColor).toBe("rgb(230, 159, 0)");
  });

  it("paints an uncolored range with no inline color, as before", () => {
    const editor = mountEditor("<p>one two</p>");
    editor.view.dom.focus();
    register(editor);

    setPluginEditorHighlights("echoes", { kind: "warning", ranges: [{ from: 0, to: 3 }] });

    const mark = markFor(editor, "warning");
    expect(mark.style.backgroundColor).toBe("");
    expect(mark.style.textDecorationColor).toBe("");
  });

  it("refuses a malformed range color at the API schema", () => {
    const row = PLUGIN_API_TABLE.find((r) => r.id === "editor.setHighlights");
    const parse = (color: string) =>
      row?.input.safeParse({ kind: "info", ranges: [{ from: 0, to: 1, color }] }).success;
    expect(parse("#0072b2")).toBe(true);
    expect(parse("#0072B2")).toBe(true);
    expect(parse("#abc")).toBe(false);
    expect(parse("0072b2")).toBe(false);
    expect(parse("red")).toBe(false);
    expect(parse("#0072b2ff")).toBe(false);
    expect(parse("url(x)")).toBe(false);
  });
});
