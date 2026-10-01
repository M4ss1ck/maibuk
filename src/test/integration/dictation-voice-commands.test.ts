import { Editor } from "@tiptap/core";
import { undo, undoDepth } from "@tiptap/pm/history";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRichTextExtensions } from "@/components/editor/extensions/createRichTextExtensions";
import { attachSession, resetDictationHubForTests } from "@/features/dictation/hub";
import {
  INITIAL_INTERPRETER_STATE,
  buildPhraseTable,
  interpret,
  type InterpreterState,
  type PhraseTableOptions,
} from "@/features/dictation/interpreter";
import { createRouter } from "@/features/dictation/router";
import { createDictationSession, type SessionNotice } from "@/features/dictation/session";
import { createLineStats } from "@/features/dictation/stats";
import type {
  DictationEvent,
  DictationLanguage,
  ModelSpec,
  RecognizerHost,
} from "@/features/dictation/types";

const models: Record<DictationLanguage, ModelSpec> = {
  en: {
    id: "test-en",
    engine: "moonshine",
    languages: ["en"],
    tier: "fast",
    platforms: ["web"],
    files: [],
    engineOptions: {},
    capabilities: { casing: true, punctuation: true, streaming: true },
  },
  es: {
    id: "test-es",
    engine: "moonshine",
    languages: ["es"],
    tier: "fast",
    platforms: ["web"],
    files: [],
    engineOptions: {},
    capabilities: { casing: false, punctuation: false, streaming: true },
  },
};

function fakeHost() {
  let listener: ((event: DictationEvent) => void) | null = null;
  return {
    emitFinal(text: string) {
      listener?.({ type: "final", text, latencyMs: 1 });
    },
    isSupported: async () => ({ supported: true as const }),
    load: async () => {},
    start: async (onEvent: (event: DictationEvent) => void) => {
      listener = onEvent;
    },
    stop: async () => {
      listener = null;
    },
    setContext: async () => {},
    inputDevice: async () => null,
    dispose: async () => {},
  } satisfies RecognizerHost & { emitFinal(text: string): void };
}

async function setup(
  options: {
    language?: DictationLanguage;
    content?: string;
    table?: PhraseTableOptions;
    /** What the runtime passes: false while a Tutorial run is under way. */
    voiceAllowed?: () => boolean;
  } = {}
) {
  const language = options.language ?? "es";
  const model = models[language];
  const host = fakeHost();
  const notices: SessionNotice[] = [];
  const stats = createLineStats();
  let state: InterpreterState = { ...INITIAL_INTERPRETER_STATE };
  const table = buildPhraseTable(language, {
    capabilities: model.capabilities,
    ...options.table,
  });
  const session = createDictationSession({
    host,
    modelFor: () => model,
    route: createRouter((line, before) => {
      const next = interpret({
        line,
        before,
        capabilities: model.capabilities,
        table,
        state,
      });
      state = next.state;
      if (next.result.kind !== "edits") return next.result;
      return { ...next.result, spokenPunctuationCount: next.spokenPunctuationCount };
    }),
    voiceCommandsAllowed: options.voiceAllowed,
    notify: (notice) => void notices.push(notice),
    copyText: vi.fn(async () => {}),
    stats,
  });
  resetDictationHubForTests();
  attachSession(session);
  const editor = new Editor({
    extensions: createRichTextExtensions({ spellCheck: { enabled: false, language } }),
    content: options.content ?? "<p></p>",
  });
  await new Promise<void>((resolve) => editor.on("create", () => resolve()));
  document.body.appendChild(editor.view.dom);
  const focused = new Promise<void>((resolve) => editor.on("focus", () => resolve()));
  editor.commands.focus();
  await focused;
  await session.start();
  return {
    editor,
    session,
    stats,
    notices,
    emit: (line: string) => host.emitFinal(line),
  };
}

afterEach(() => resetDictationHubForTests());

describe("Voice Commands in a real editor session", () => {
  it("sets and unsets every mark the defaults cover", async () => {
    const { editor, emit } = await setup({ content: "<p>hola</p>" });
    const marks = [
      ["poner negrita", "quitar negrita", "strong"],
      ["poner cursiva", "quitar cursiva", "em"],
      ["poner subrayado", "quitar subrayado", "u"],
      ["poner tachado", "quitar tachado", "s"],
      ["poner código", "quitar código", "code"],
    ] as const;
    for (const [on, off, tag] of marks) {
      editor.commands.setTextSelection({ from: 1, to: 5 });
      emit(on);
      expect(editor.getHTML(), on).toContain(`<${tag}>hola</${tag}>`);
      editor.commands.setTextSelection({ from: 1, to: 5 });
      emit(off);
      expect(editor.getHTML(), off).not.toContain(`<${tag}>`);
    }
  });

  it("sets a mark for the text dictated next and never toggles it off again", async () => {
    const { editor, emit, stats } = await setup();
    emit("poner negrita");
    expect(editor.getHTML()).toBe("<p></p>");
    emit("hola");
    expect(editor.getHTML()).toBe("<p><strong>Hola</strong></p>");
    // On-verbs set: saying it again keeps bold on instead of toggling it off.
    emit("poner negrita");
    emit("mundo");
    expect(editor.getHTML()).toBe("<p><strong>Hola mundo</strong></p>");
    expect(stats.summary().voiceCommandCount).toBe(2);
    expect(stats.summary().spokenPunctuationCount).toBe(0);
  });

  it("unsets a mark without touching the text already dictated", async () => {
    const { editor, emit } = await setup();
    emit("poner negrita");
    emit("hola");
    emit("quitar negrita");
    emit("adios");
    expect(editor.getHTML()).toBe("<p><strong>Hola</strong> adios</p>");
  });

  it("keeps the mark the Command set across a spoken paragraph break", async () => {
    const { editor, emit } = await setup();
    emit("poner negrita");
    emit("nuevo párrafo hola");
    expect(editor.getHTML()).toContain("<p><strong>Hola</strong></p>");
  });

  it("keeps the separating space out of the mark", async () => {
    const { editor, emit } = await setup();
    emit("uno");
    emit("poner negrita");
    emit("dos");
    expect(editor.getHTML()).toBe("<p>Uno <strong>dos</strong></p>");
  });

  it("keeps a mark running through the separating space", async () => {
    for (const [on, tag] of [
      ["poner subrayado", "u"],
      ["poner tachado", "s"],
    ] as const) {
      const { editor, emit } = await setup();
      emit(on);
      emit("hola");
      emit("mundo");
      expect(editor.getHTML(), on).toBe(`<p><${tag}>Hola mundo</${tag}></p>`);
      editor.destroy();
    }

    // Inline code is non-inclusive at its trailing edge (CustomCode), so the
    // caret there is outside the mark and the next word is plain, exactly as
    // when typing after the edge.
    const code = await setup();
    code.emit("poner código");
    code.emit("hola");
    code.emit("mundo");
    expect(code.editor.getHTML()).toBe("<p><code>Hola</code> mundo</p>");
  });

  it("keeps a typed mark running through the separating space", async () => {
    const { editor, emit } = await setup({ content: "<p><strong>Uno</strong></p>" });
    editor.commands.setTextSelection(4);
    emit("dos");
    expect(editor.getHTML()).toBe("<p><strong>Uno dos</strong></p>");
  });

  it("keeps a typed link running through the separating space", async () => {
    const { editor, emit } = await setup({
      content: '<p><a href="https://example.com">Uno</a></p>',
    });
    editor.commands.setTextSelection(4);
    emit("dos");
    const html = editor.getHTML();
    expect(html).toContain("Uno dos");
    expect((html.match(/<a /g) ?? []).length).toBe(1);
  });

  it("changes nothing when an off-verb runs on plain text, and still announces", async () => {
    const { editor, emit, notices } = await setup({ content: "<p>hola mundo</p>" });
    const depth = undoDepth(editor.state);
    emit("quitar negrita");
    expect(editor.getHTML()).toBe("<p>hola mundo</p>");
    expect(undoDepth(editor.state)).toBe(depth);
    expect(notices).toContainEqual({ kind: "voice_command", id: "editor.bold", polarity: "off" });
  });

  it("acts on the selection as one undo step", async () => {
    const { editor, emit } = await setup({ content: "<p>hola mundo</p>" });
    editor.commands.setTextSelection({ from: 1, to: 5 });
    emit("poner cursiva");
    expect(editor.getHTML()).toBe("<p><em>hola</em> mundo</p>");
    expect(undoDepth(editor.state)).toBe(1);
    undo(editor.state, editor.view.dispatch);
    expect(editor.getHTML()).toBe("<p>hola mundo</p>");
  });

  it("converts the current block to a heading, as one undo step", async () => {
    const { editor, emit } = await setup({ content: "<p>hola mundo</p>" });
    editor.commands.setTextSelection(3);
    emit("convertir en título uno");
    // The heading carries an id for Links; TipTap keeps a trailing paragraph after it.
    expect(editor.getHTML()).toMatch(/^<h1[^>]*>hola mundo<\/h1>/);
    expect(undoDepth(editor.state)).toBe(1);
    undo(editor.state, editor.view.dispatch);
    expect(editor.getHTML()).toContain("<p>hola mundo</p>");
  });

  it("converts a block once, never toggling it back", async () => {
    const { editor, emit } = await setup({ content: "<p>hola</p>" });
    editor.commands.setTextSelection(2);
    emit("convertir en título uno");
    expect(editor.getHTML()).toMatch(/^<h1[^>]*>hola<\/h1>/);
    emit("convertir en título uno");
    expect(editor.getHTML()).toMatch(/^<h1[^>]*>hola<\/h1>/);
    expect((editor.getHTML().match(/<h1/g) ?? []).length).toBe(1);
    emit("convertir en cita");
    expect((editor.getHTML().match(/<blockquote>/g) ?? []).length).toBe(1);
    emit("convertir en cita");
    expect((editor.getHTML().match(/<blockquote>/g) ?? []).length).toBe(1);
  });

  it("starts a list on the current block", async () => {
    const { editor, emit } = await setup({ content: "<p>hola</p>" });
    editor.commands.setTextSelection(2);
    emit("empezar lista");
    expect(editor.getHTML()).toContain("<ul><li><p>hola</p></li></ul>");
  });

  it("starts a list only when it is not already one, and ends it only when it is", async () => {
    const { editor, emit } = await setup({ content: "<p>hola</p>" });
    editor.commands.setTextSelection(2);
    emit("terminar lista");
    expect(editor.getHTML()).toBe("<p>hola</p>");
    emit("empezar lista");
    expect(editor.getHTML()).toContain("<ul><li><p>hola</p></li></ul>");
    emit("empezar lista");
    expect((editor.getHTML().match(/<ul>/g) ?? []).length).toBe(1);
    emit("terminar lista");
    expect(editor.getHTML()).not.toContain("<ul>");
    emit("terminar lista");
    expect(editor.getHTML()).not.toContain("<ul>");
  });

  it("starts and ends a numbered list the same way", async () => {
    const { editor, emit } = await setup({ content: "<p>hola</p>" });
    editor.commands.setTextSelection(2);
    emit("terminar lista numerada");
    expect(editor.getHTML()).toBe("<p>hola</p>");
    emit("empezar lista numerada");
    expect(editor.getHTML()).toContain("<ol>");
    emit("empezar lista numerada");
    expect((editor.getHTML().match(/<ol>/g) ?? []).length).toBe(1);
    emit("salir de la lista numerada");
    expect(editor.getHTML()).not.toContain("<ol>");
  });

  it("ends whichever list the caret is in with the generic list noun", async () => {
    const { editor, emit } = await setup({ content: "<p>hola</p>" });
    editor.commands.setTextSelection(2);
    emit("empezar lista numerada");
    expect(editor.getHTML()).toContain("<ol>");
    emit("terminar lista");
    expect(editor.getHTML()).not.toContain("<ol>");

    // A specific target never ends the other list type.
    emit("empezar lista");
    expect(editor.getHTML()).toContain("<ul>");
    emit("terminar lista numerada");
    expect(editor.getHTML()).toContain("<ul>");
    expect(editor.getHTML()).not.toContain("<ol>");
  });

  it("ends a numbered list in English with the generic target", async () => {
    const { editor, emit } = await setup({ language: "en", content: "<p>hello</p>" });
    editor.commands.setTextSelection(2);
    emit("start numbered list");
    expect(editor.getHTML()).toContain("<ol>");
    emit("end list");
    expect(editor.getHTML()).not.toContain("<ol>");
  });

  it("starts and ends a list in English the same way", async () => {
    const { editor, emit } = await setup({ language: "en", content: "<p>hello</p>" });
    editor.commands.setTextSelection(2);
    emit("end list");
    expect(editor.getHTML()).toBe("<p>hello</p>");
    emit("start bullet list");
    expect(editor.getHTML()).toContain("<ul><li><p>hello</p></li></ul>");
    emit("start list");
    expect((editor.getHTML().match(/<ul>/g) ?? []).length).toBe(1);
    emit("end list");
    expect(editor.getHTML()).not.toContain("<ul>");
  });

  it("undoes the last dictated line by voice", async () => {
    const { editor, emit } = await setup();
    emit("hola");
    expect(editor.getHTML()).toBe("<p>Hola</p>");
    emit("deshacer eso");
    expect(editor.getHTML()).toBe("<p></p>");
  });

  it("makes a Voice Command its own undo step, not part of the previous line's", async () => {
    const { editor, emit } = await setup();
    emit("hola");
    expect(editor.getHTML()).toBe("<p>Hola</p>");
    emit("convertir en título uno");
    expect(editor.getHTML()).toMatch(/<h1/);
    undo(editor.state, editor.view.dispatch);
    expect(editor.getHTML()).toContain("<p>Hola</p>");
    expect(editor.getHTML()).not.toContain("<h1");
    undo(editor.state, editor.view.dispatch);
    expect(editor.getHTML()).not.toContain("Hola");
  });

  it("announces nothing-to-undo without counting it as a run", async () => {
    const { editor, emit, notices, stats } = await setup();
    const depth = undoDepth(editor.state);
    emit("deshacer eso");
    expect(notices).toContainEqual({ kind: "voice_command_empty", id: "common.undo" });
    expect(stats.summary().voiceCommandCount).toBe(0);
    expect(undoDepth(editor.state)).toBe(depth);
    emit("hola");
    emit("deshacer eso");
    expect(editor.getHTML()).toBe("<p></p>");
    expect(stats.summary().voiceCommandCount).toBe(1);
  });

  it("stops the Dictation Session by voice", async () => {
    const { session, emit, notices } = await setup();
    emit("parar dictado");
    await vi.waitFor(() => expect(session.getSnapshot().status).toBe("idle"));
    expect(notices).toContainEqual({ kind: "stopped" });
  });

  it("never inserts the Command's words", async () => {
    const { editor, emit, notices } = await setup();
    emit("poner negrita");
    expect(editor.getHTML()).toBe("<p></p>");
    expect(notices).toContainEqual({ kind: "voice_command", id: "editor.bold", polarity: "on" });
  });

  it("types prose that contains command words, with no announcement", async () => {
    const { editor, emit, notices } = await setup();
    emit("puso la negrita en el título");
    expect(editor.getHTML()).toBe("<p>Puso la negrita en el título</p>");
    expect(notices.filter((notice) => notice.kind === "voice_command")).toEqual([]);
  });

  it("types short English sentences that only command words could fire on", async () => {
    const { editor, emit, notices } = await setup({ language: "en" });
    for (const line of ["Use the code.", "Center the text.", "Stop the list."]) {
      emit(line);
    }
    expect(editor.getHTML()).toBe("<p>Use the code. Center the text. Stop the list.</p>");
    expect(notices.filter((notice) => notice.kind === "voice_command")).toEqual([]);
  });

  it("runs English Voice Commands for an English editor", async () => {
    const { editor, emit, notices } = await setup({ language: "en" });
    emit("make bold");
    emit("hello");
    expect(editor.getHTML()).toBe("<p><strong>Hello</strong></p>");
    emit("remove bold");
    emit("world");
    expect(editor.getHTML()).toBe("<p><strong>Hello</strong> world</p>");
    expect(notices).toContainEqual({ kind: "voice_command", id: "editor.bold", polarity: "on" });
  });

  it("blocks Voice Commands while the Tutorial runs, without inserting them", async () => {
    const { editor, emit, notices } = await setup({ voiceAllowed: () => false });
    emit("poner negrita");
    expect(editor.getHTML()).toBe("<p></p>");
    expect(notices.filter((notice) => notice.kind === "voice_command")).toEqual([]);
    emit("hola");
    expect(editor.getHTML()).toBe("<p>Hola</p>");
  });

  it("never fires for a written form the Dictation Vocabulary produced", async () => {
    const { editor, emit } = await setup({
      table: { vocabulary: [{ heard: "orden", written: "poner negrita" }] },
    });
    emit("orden");
    expect(editor.getHTML()).toBe("<p>poner negrita</p>");
  });
});
