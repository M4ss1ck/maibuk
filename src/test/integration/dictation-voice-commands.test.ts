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

  it("starts a list on the current block", async () => {
    const { editor, emit } = await setup({ content: "<p>hola</p>" });
    editor.commands.setTextSelection(2);
    emit("empezar lista");
    expect(editor.getHTML()).toContain("<ul><li><p>hola</p></li></ul>");
  });

  it("undoes the last dictated line by voice", async () => {
    const { editor, emit } = await setup();
    emit("hola");
    expect(editor.getHTML()).toBe("<p>Hola</p>");
    emit("deshacer eso");
    expect(editor.getHTML()).toBe("<p></p>");
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
