import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { undo, undoDepth } from "@tiptap/pm/history";
import type { DecorationSet } from "@tiptap/pm/view";
import { createRichTextExtensions } from "@/components/editor/extensions/createRichTextExtensions";
import { dictationPluginKey } from "@/components/editor/extensions/Dictation";
import { attachSession, resetDictationHubForTests } from "@/features/dictation/hub";
import type { DictationTarget } from "@/features/dictation/session";

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

  it("shows a partial without changing the document, undo history, or firing update", async () => {
    const editor = await makeEditor();
    const onUpdate = vi.fn();
    editor.on("update", onUpdate);
    const before = editor.getJSON();
    targets[0].showPartial("mundo");
    expect(dictationPluginKey.getState(editor.state)).toBe("mundo");
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
    expect(dictationPluginKey.getState(editor.state)).toBe("");
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
    expect(dictationPluginKey.getState(editor.state)).toBe("mun");
    const plugin = dictationPluginKey.get(editor.state)!;
    const decorations = plugin.props.decorations!.call(plugin, editor.state);
    const [widget] = (decorations as DecorationSet).find();
    expect(widget.from).toBe(editor.state.selection.to);
    targets[0].showPartial("mundo");
    editor.commands.insertContent(" o");
    targets[0].apply([{ kind: "text", text: "mundo" }]);
    expect(editor.getText()).toBe("Hola y o mundo");
    expect(dictationPluginKey.getState(editor.state)).toBe("");
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
