import { Editor } from "@tiptap/core";
import { undo, undoDepth } from "@tiptap/pm/history";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRichTextExtensions } from "@/components/editor/extensions/createRichTextExtensions";
import { attachSession, resetDictationHubForTests } from "@/features/dictation/hub";
import {
  INITIAL_INTERPRETER_STATE,
  buildPhraseTable,
  interpret,
} from "@/features/dictation/interpreter";
import { createRouter } from "@/features/dictation/router";
import { createDictationSession } from "@/features/dictation/session";
import { createLineStats } from "@/features/dictation/stats";
import type { DictationEvent, ModelSpec, RecognizerHost } from "@/features/dictation/types";
import type { VocabularyEntry } from "@/features/dictation/vocabulary";

const model: ModelSpec = {
  id: "test-es",
  engine: "moonshine",
  languages: ["es"],
  tier: "fast",
  platforms: ["web"],
  files: [],
  engineOptions: {},
  capabilities: { casing: false, punctuation: false, streaming: true },
};

function fakeHost() {
  let listener: ((event: DictationEvent) => void) | null = null;
  return {
    emitFinal(text: string) {
      listener?.({ type: "final", text, latencyMs: 1 });
    },
    setContext: vi.fn(async () => {}),
    isSupported: async () => ({ supported: true as const }),
    load: async () => {},
    start: async (onEvent: (event: DictationEvent) => void) => {
      listener = onEvent;
    },
    stop: async () => {
      listener = null;
    },
    inputDevice: async () => null,
    dispose: async () => {},
  } satisfies RecognizerHost & { emitFinal(text: string): void };
}

async function makeEditor() {
  const editor = new Editor({
    extensions: createRichTextExtensions({ spellCheck: { enabled: false, language: "es" } }),
    content: "<p></p>",
  });
  await new Promise<void>((resolve) => editor.on("create", () => resolve()));
  document.body.appendChild(editor.view.dom);
  return editor;
}

async function focusEditor(editor: Editor) {
  const focused = new Promise<void>((resolve) => editor.on("focus", () => resolve()));
  editor.commands.focus();
  await focused;
}

function setupSession(vocabulary: VocabularyEntry[]) {
  const host = fakeHost();
  let state = { ...INITIAL_INTERPRETER_STATE };
  const table = buildPhraseTable("es", { vocabulary });
  const session = createDictationSession({
    host,
    modelFor: () => model,
    route: createRouter((line, before) => {
      const next = interpret({ line, before, capabilities: model.capabilities, table, state });
      state = next.state;
      if (next.result.kind === "scratch") return { kind: "scratch" };
      return { ...next.result, spokenPunctuationCount: next.spokenPunctuationCount };
    }),
    runCommand: vi.fn(),
    notify: vi.fn(),
    copyText: vi.fn(async () => {}),
    stats: createLineStats(),
  });
  resetDictationHubForTests();
  attachSession(session);
  return { host, session };
}

const ENTRY: VocabularyEntry = { heard: "a reliano", written: "Aureliano" };

afterEach(() => {
  resetDictationHubForTests();
  document.body.innerHTML = "";
});

describe("Dictation Vocabulary (Seam 1)", () => {
  it("writes the written form into the Chapter exactly as typed, as one undo step", async () => {
    const { host, session } = setupSession([ENTRY]);
    const editor = await makeEditor();
    try {
      await focusEditor(editor);
      await session.start();
      host.emitFinal("hola a reliano punto");
      expect(editor.getHTML()).toBe("<p>Hola Aureliano.</p>");
      expect(undoDepth(editor.state)).toBe(1);
      undo(editor.state, editor.view.dispatch);
      expect(editor.getHTML()).toBe("<p></p>");
      expect(host.setContext).not.toHaveBeenCalled();
    } finally {
      editor.destroy();
    }
  });

  it("matches whole words, folding case and accents, and takes the longest match", async () => {
    const { host, session } = setupSession([
      { heard: "reliano", written: "Reliano" },
      { heard: "buendia", written: "Buendía" },
      ENTRY,
    ]);
    const editor = await makeEditor();
    try {
      await focusEditor(editor);
      await session.start();
      host.emitFinal("mariano y BUENDÍA");
      expect(editor.getHTML()).toBe("<p>Mariano y Buendía</p>");
      host.emitFinal("a reliano punto");
      expect(editor.getHTML()).toBe("<p>Mariano y Buendía Aureliano.</p>");
    } finally {
      editor.destroy();
    }
  });

  it("never reinterprets the written form as a layout phrase", async () => {
    const { host, session } = setupSession([{ heard: "marca", written: "Nuevo párrafo" }]);
    const editor = await makeEditor();
    try {
      await focusEditor(editor);
      await session.start();
      host.emitFinal("hola marca");
      expect(editor.getHTML()).toBe("<p>Hola Nuevo párrafo</p>");
      expect(undoDepth(editor.state)).toBe(1);
    } finally {
      editor.destroy();
    }
  });

  it("never reinterprets the written form as scratch that", async () => {
    const { host, session } = setupSession([{ heard: "vora eso", written: "borra eso" }]);
    const editor = await makeEditor();
    try {
      await focusEditor(editor);
      await session.start();
      host.emitFinal("vora eso");
      expect(editor.getHTML()).toBe("<p>borra eso</p>");
      // The line stands; a real scratch after it removes it like any dictated line.
      host.emitFinal("borra eso");
      expect(editor.getHTML()).toBe("<p></p>");
      expect(undoDepth(editor.state)).toBe(2);
    } finally {
      editor.destroy();
    }
  });
});
