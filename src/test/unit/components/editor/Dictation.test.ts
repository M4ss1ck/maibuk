import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { undo, undoDepth } from "@tiptap/pm/history";
import type { DecorationSet } from "@tiptap/pm/view";
import { createRichTextExtensions } from "@/components/editor/extensions/createRichTextExtensions";
import { dictationPluginKey } from "@/components/editor/extensions/Dictation";
import { VOICE_MARKS } from "@/components/editor/editor-commands";
import { attachSession, resetDictationHubForTests } from "@/features/dictation/hub";
import type { DictationTarget } from "@/features/dictation/session";
import { isMarkCommand, voiceEligibleCommands } from "@/features/dictation/voice-commands";

let targets: DictationTarget[];
const focus = vi.fn();
const stop = vi.fn(async () => {});
let status: "idle" | "listening" = "idle";

// TipTap emits "create" (and runs extension `onCreate`) on a macrotask, so the
// editor must settle before an editor becomes a registered target.
async function makeEditor(content = "<p>Hola</p>", language: "en" | "es" = "es") {
  const editor = new Editor({
    extensions: createRichTextExtensions({
      spellCheck: { enabled: false, language },
    }),
    content,
  });
  await new Promise<void>((resolve) => editor.on("create", () => resolve()));
  // jsdom only fires focus events for elements connected to the document.
  document.body.appendChild(editor.view.dom);
  editor.commands.setTextSelection(editor.state.doc.content.size - 1); // end of the paragraph
  return editor;
}

beforeEach(() => {
  targets = [];
  status = "idle";
  focus.mockClear();
  stop.mockClear();
  resetDictationHubForTests();
  attachSession({
    register: (t) => {
      targets.push(t);
      return () => {
        targets = targets.filter((x) => x !== t);
      };
    },
    focus,
    stop,
    getSnapshot: () => ({
      status,
      language: null,
      modelId: null,
      level: 0,
      hasTarget: true,
    }),
  });
});

afterEach(() => resetDictationHubForTests());

describe("Dictation extension", () => {
  it("registers the editor as a target in its Spell Check language", async () => {
    const editor = await makeEditor("<p>x</p>", "es");
    expect(targets).toHaveLength(1);
    expect(targets[0].language()).toBe("es");
    editor.destroy();
    expect(targets).toHaveLength(0);
  });

  it("reports unavailable behind a modal layer and available otherwise", async () => {
    const editor = await makeEditor("<p>x</p>", "es");
    expect(targets).toHaveLength(1);
    expect(targets[0].isAvailable?.()).toBe(true);
    // A modal over the editor hides its DOM with aria-hidden: the Session
    // must treat it as absent and take the orphan path.
    const modal = document.createElement("div");
    modal.setAttribute("aria-hidden", "true");
    document.body.appendChild(modal);
    modal.appendChild(editor.view.dom);
    expect(targets[0].isAvailable?.()).toBe(false);
    document.body.appendChild(editor.view.dom);
    expect(targets[0].isAvailable?.()).toBe(true);
    const inert = document.createElement("div");
    inert.setAttribute("inert", "");
    document.body.appendChild(inert);
    inert.appendChild(editor.view.dom);
    expect(targets[0].isAvailable?.()).toBe(false);
    editor.destroy();
    modal.remove();
    inert.remove();
  });

  it("shows a partial without changing the document, undo history, or firing update", async () => {
    const editor = await makeEditor();
    const onUpdate = vi.fn();
    editor.on("update", onUpdate);
    const before = editor.getJSON();
    targets[0].showPartial("mundo");
    expect(dictationPluginKey.getState(editor.state)?.partial).toBe("mundo");
    expect(editor.view.dom.querySelector(".dictation-partial")?.textContent).toBe(" mundo");
    expect(editor.getJSON()).toEqual(before);
    expect(undoDepth(editor.state)).toBe(0);
    expect(onUpdate).not.toHaveBeenCalled();
    editor.destroy();
  });

  it("commits a line at the caret with a separating space, as one undo step", async () => {
    const editor = await makeEditor();
    targets[0].showPartial("mundo");
    targets[0].apply([{ kind: "text", text: "mundo" }]);
    expect(editor.getText()).toBe("Hola mundo");
    expect(dictationPluginKey.getState(editor.state)?.partial).toBe("");
    undo(editor.state, editor.view.dispatch);
    expect(editor.getText()).toBe("Hola");
    editor.destroy();
  });

  it("applies a list of text edits in one transaction and undo step", async () => {
    const editor = await makeEditor();
    const onUpdate = vi.fn();
    editor.on("update", onUpdate);
    targets[0].apply([
      { kind: "text", text: "uno" },
      { kind: "text", text: "dos" },
    ]);
    expect(editor.getHTML()).toBe("<p>Hola uno dos</p>");
    expect(undoDepth(editor.state)).toBe(1);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    undo(editor.state, editor.view.dispatch);
    expect(editor.getHTML()).toBe("<p>Hola</p>");
    editor.destroy();
  });

  it("applies spoken paragraph and line breaks in one undo step", async () => {
    const editor = await makeEditor("<p>Hola</p>");
    targets[0].apply([
      { kind: "text", text: ", mundo." },
      { kind: "paragraph" },
      { kind: "text", text: "Otro verso" },
      { kind: "line_break" },
      { kind: "text", text: "final" },
    ]);
    expect(editor.getHTML()).toBe("<p>Hola, mundo.</p><p>Otro verso<br>final</p>");
    expect(undoDepth(editor.state)).toBe(1);
    undo(editor.state, editor.view.dispatch);
    expect(editor.getHTML()).toBe("<p>Hola</p>");
    editor.destroy();
  });

  it("removes trailing spaces before a spoken closing mark", async () => {
    const editor = await makeEditor("<p>Hola</p>");
    editor.commands.insertContent("  ");
    targets[0].apply([{ kind: "text", text: ", mundo" }]);
    expect(editor.getHTML()).toBe("<p>Hola, mundo</p>");
    undo(editor.state, editor.view.dispatch);
    expect(editor.getHTML()).toBe("<p>Hola  </p>");
    editor.destroy();
  });

  it("starts a plain paragraph after a heading", async () => {
    const editor = await makeEditor("<h1>Hola</h1>");
    editor.commands.setTextSelection(5);
    const initialUndoDepth = undoDepth(editor.state);
    targets[0].apply([{ kind: "paragraph" }, { kind: "text", text: "Mundo" }]);
    expect(editor.state.doc.child(0).type.name).toBe("heading");
    expect(editor.state.doc.child(1).type.name).toBe("paragraph");
    expect(editor.state.doc.child(1).textContent).toBe("Mundo");
    expect(undoDepth(editor.state)).toBe(initialUndoDepth + 1);
    undo(editor.state, editor.view.dispatch);
    expect(editor.state.doc.child(0).textContent).toBe("Hola");
    editor.destroy();
  });

  it("does not add a space after whitespace, an opening mark, or at a paragraph start", async () => {
    for (const [content, expected] of [
      ["<p>Hola </p>", "Hola mundo"],
      ["<p>¿</p>", "¿mundo"],
      ["<p></p>", "mundo"],
    ] as const) {
      const editor = await makeEditor(content);
      targets.at(-1)!.apply([{ kind: "text", text: "mundo" }]);
      expect(editor.getText()).toBe(expected);
      editor.destroy();
    }
  });

  it("replaces a range selection", async () => {
    const editor = await makeEditor("<p>Hola gente</p>");
    editor.commands.setTextSelection({ from: 6, to: 11 }); // "gente"
    targets[0].apply([{ kind: "text", text: "mundo" }]);
    expect(editor.getText()).toBe("Hola mundo");
    editor.destroy();
  });

  it("typing while partial shows: typed text stays, the final lands after it", async () => {
    const editor = await makeEditor();
    targets[0].showPartial("mun");
    editor.commands.insertContent(" y");
    // The partial never entered the document, so typing could not displace it...
    expect(editor.getText()).toBe("Hola y");
    // ...and it stays visible, now after the typed text at the caret.
    expect(dictationPluginKey.getState(editor.state)?.partial).toBe("mun");
    const plugin = dictationPluginKey.get(editor.state)!;
    const decorations = plugin.props.decorations!.call(plugin, editor.state);
    const [widget] = (decorations as DecorationSet).find();
    expect(widget.from).toBe(editor.state.selection.to);
    targets[0].showPartial("mundo");
    editor.commands.insertContent(" o");
    targets[0].apply([{ kind: "text", text: "mundo" }]);
    expect(editor.getText()).toBe("Hola y o mundo");
    expect(dictationPluginKey.getState(editor.state)?.partial).toBe("");
    editor.destroy();
  });

  it("reports focus to the session", async () => {
    const editor = await makeEditor();
    const reported = new Promise<void>((resolve) => editor.on("focus", () => resolve()));
    editor.commands.focus();
    await reported;
    expect(focus).toHaveBeenCalledWith(targets[0].id);
    editor.destroy();
  });

  it("Escape stops a listening session and is ignored otherwise", async () => {
    const editor = await makeEditor();
    const press = () =>
      editor.view.someProp("handleKeyDown", (f) =>
        f(editor.view, new KeyboardEvent("keydown", { key: "Escape" }))
      );
    expect(press()).toBeFalsy();
    status = "listening";
    expect(press()).toBe(true);
    expect(stop).toHaveBeenCalledTimes(1);
    editor.destroy();
  });

  it("a read-only editor ignores commits", async () => {
    const editor = await makeEditor();
    editor.setEditable(false);
    targets[0].apply([{ kind: "text", text: "mundo" }]);
    expect(editor.getText()).toBe("Hola");
    editor.destroy();
  });
});

describe("Dictation voice that", () => {
  async function dictateTwoSentences() {
    const editor = await makeEditor("<p></p>");
    targets[0].apply([{ kind: "text", text: "Hello there." }]);
    targets[0].apply([{ kind: "text", text: "Second one." }]);
    expect(editor.getHTML()).toBe("<p>Hello there. Second one.</p>");
    return editor;
  }

  it("has an editor mark for every mark Command, so no that phrase runs into nothing", async () => {
    const editor = await makeEditor("<p></p>");
    const marks = voiceEligibleCommands().filter(isMarkCommand);
    expect(marks.length).toBeGreaterThan(0);
    for (const id of marks) {
      const name = VOICE_MARKS[id];
      expect(name && editor.schema.marks[name], id).toBeTruthy();
    }
  });

  it("bolds the last dictated sentence, leaves the rest plain, keeps the caret", async () => {
    const editor = await dictateTwoSentences();
    const { from, to } = editor.state.selection;
    const outcome = targets[0].voice!({ id: "editor.bold", polarity: "on", that: true });
    expect(outcome).toBe("ran");
    expect(editor.getHTML()).toBe("<p>Hello there. <strong>Second one.</strong></p>");
    expect(editor.state.selection.from).toBe(from);
    expect(editor.state.selection.to).toBe(to);
    editor.destroy();
  });

  it("removes the mark in one undo step and leaves the text", async () => {
    const editor = await dictateTwoSentences();
    targets[0].voice!({ id: "editor.bold", polarity: "on", that: true });
    editor.commands.undo();
    expect(editor.getHTML()).toBe("<p>Hello there. Second one.</p>");
    editor.destroy();
  });

  it("removes the mark from the span with polarity off", async () => {
    const editor = await dictateTwoSentences();
    targets[0].voice!({ id: "editor.bold", polarity: "on", that: true });
    expect(editor.getHTML()).toContain("<strong>");
    const outcome = targets[0].voice!({ id: "editor.bold", polarity: "off", that: true });
    expect(outcome).toBe("ran");
    expect(editor.getHTML()).toBe("<p>Hello there. Second one.</p>");
    editor.destroy();
  });

  it("marks only the last line of an unfinished sentence", async () => {
    const editor = await makeEditor("<p></p>");
    targets[0].apply([{ kind: "text", text: "one two" }]);
    targets[0].apply([{ kind: "text", text: "three four" }]);
    expect(editor.getHTML()).toBe("<p>one two three four</p>");
    const outcome = targets[0].voice!({ id: "editor.bold", polarity: "on", that: true });
    expect(outcome).toBe("ran");
    expect(editor.getHTML()).toBe("<p>one two <strong>three four</strong></p>");
    editor.destroy();
  });

  it("refuses when the author edited inside the span", async () => {
    const editor = await dictateTwoSentences();
    editor.commands.setTextSelection(18);
    editor.commands.insertContent("X");
    const edited = editor.getHTML();
    expect(edited).toContain("X");
    const outcome = targets[0].voice!({ id: "editor.bold", polarity: "on", that: true });
    expect(outcome).toBe("refused");
    expect(editor.getHTML()).toBe(edited);
    expect(editor.getHTML()).not.toContain("<strong>");
    editor.destroy();
  });

  it("reports empty with nothing dictated", async () => {
    const editor = await makeEditor("<p></p>");
    const outcome = targets[0].voice!({ id: "editor.bold", polarity: "on", that: true });
    expect(outcome).toBe("empty");
    expect(editor.getHTML()).toBe("<p></p>");
    editor.destroy();
  });

  it("bolds the selection, not the dictated span, with a real selection", async () => {
    const editor = await dictateTwoSentences();
    editor.commands.setTextSelection({ from: 1, to: 13 });
    const outcome = targets[0].voice!({ id: "editor.bold", polarity: "on", that: true });
    expect(outcome).toBe("ran");
    expect(editor.getHTML()).toBe("<p><strong>Hello there.</strong> Second one.</p>");
    editor.destroy();
  });

  it("scratches the sentence after bolding it", async () => {
    const editor = await dictateTwoSentences();
    targets[0].voice!({ id: "editor.bold", polarity: "on", that: true });
    expect(targets[0].scratch!()).toBe("removed");
    expect(editor.getHTML()).toBe("<p>Hello there.</p>");
    editor.destroy();
  });

  it("keeps the author's pending stored marks", async () => {
    const editor = await dictateTwoSentences();
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.setItalic();
    expect(editor.state.storedMarks?.some((mark) => mark.type.name === "italic")).toBe(true);
    const outcome = targets[0].voice!({ id: "editor.bold", polarity: "on", that: true });
    expect(outcome).toBe("ran");
    expect(editor.getHTML()).toBe("<p>Hello there. <strong>Second one.</strong></p>");
    expect(editor.state.storedMarks?.some((mark) => mark.type.name === "italic")).toBe(true);
    editor.destroy();
  });
});
