import { Editor } from "@tiptap/core";
import { undo, undoDepth } from "@tiptap/pm/history";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRichTextExtensions } from "@/components/editor/extensions/createRichTextExtensions";
import { dictationPluginKey } from "@/components/editor/extensions/Dictation";
import { attachSession, resetDictationHubForTests } from "@/features/dictation/hub";
import {
  INITIAL_INTERPRETER_STATE,
  buildPhraseTable,
  interpret,
} from "@/features/dictation/interpreter";
import { createRouter } from "@/features/dictation/router";
import { createDictationSession, type SessionNotice } from "@/features/dictation/session";
import { createLineStats, type LineStats } from "@/features/dictation/stats";
import type { DictationEvent, ModelSpec, RecognizerHost } from "@/features/dictation/types";

const capabilities = { casing: false, punctuation: false, streaming: true } as const;

const model: ModelSpec = {
  id: "test-es",
  engine: "moonshine",
  languages: ["es"],
  tier: "fast",
  platforms: ["web"],
  files: [],
  engineOptions: {},
  capabilities: { ...capabilities },
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

async function makeEditor(content = "<p></p>") {
  const editor = new Editor({
    extensions: createRichTextExtensions({ spellCheck: { enabled: false, language: "es" } }),
    content,
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

function setupSession(opts?: {
  stats?: LineStats;
  notices?: SessionNotice[];
  language?: "en" | "es";
}) {
  const host = fakeHost();
  let state = { ...INITIAL_INTERPRETER_STATE };
  const language = opts?.language ?? "es";
  const table = buildPhraseTable(language);
  const stats = opts?.stats ?? createLineStats();
  const notices = opts?.notices ?? [];
  const spec: ModelSpec = {
    ...model,
    languages: [language],
    capabilities: { ...model.capabilities },
  };
  const session = createDictationSession({
    host,
    modelFor: () => spec,
    route: createRouter((line, before) => {
      const next = interpret({ line, before, capabilities: spec.capabilities, table, state });
      state = next.state;
      if (next.result.kind === "scratch") return { kind: "scratch" };
      return { ...next.result, spokenPunctuationCount: next.spokenPunctuationCount };
    }),
    runCommand: vi.fn(),
    notify: (n) => void notices.push(n),
    copyText: vi.fn(async () => {}),
    stats,
  });
  resetDictationHubForTests();
  attachSession(session);
  return { host, session, stats, notices };
}

afterEach(() => {
  resetDictationHubForTests();
  document.body.innerHTML = "";
});

describe("Dictation scratch that (Seam 1)", () => {
  it("removes one dictated sentence per scratch as one undo step each", async () => {
    const { host, session, stats } = setupSession();
    const editor = await makeEditor();
    try {
      await focusEditor(editor);
      await session.start();
      host.emitFinal("uno punto dos punto tres punto");
      expect(editor.getHTML()).toBe("<p>Uno. Dos. Tres.</p>");
      expect(undoDepth(editor.state)).toBe(1);

      host.emitFinal("borra eso");
      expect(editor.getHTML()).toBe("<p>Uno. Dos.</p>");
      expect(undoDepth(editor.state)).toBe(2);
      expect(stats.summary().scratchCount).toBe(1);

      host.emitFinal("borra eso");
      expect(editor.getHTML()).toBe("<p>Uno.</p>");

      host.emitFinal("borra eso");
      expect(editor.getHTML()).toBe("<p></p>");
      expect(stats.summary().scratchCount).toBe(3);

      host.emitFinal("borra eso");
      expect(editor.getHTML()).toBe("<p></p>");

      undo(editor.state, editor.view.dispatch);
      expect(editor.getHTML()).toBe("<p>Uno.</p>");
    } finally {
      editor.destroy();
    }
  });

  it("keeps only ten sentences of history", async () => {
    const { host, session } = setupSession();
    const editor = await makeEditor();
    try {
      await focusEditor(editor);
      await session.start();
      host.emitFinal(
        "uno punto dos punto tres punto cuatro punto cinco punto seis punto siete punto ocho punto nueve punto diez punto once punto"
      );
      expect(editor.getHTML()).toBe(
        "<p>Uno. Dos. Tres. Cuatro. Cinco. Seis. Siete. Ocho. Nueve. Diez. Once.</p>"
      );
      for (let i = 0; i < 10; i += 1) host.emitFinal("borra eso");
      expect(editor.getHTML()).toBe("<p>Uno.</p>");
      host.emitFinal("borra eso");
      expect(editor.getHTML()).toBe("<p>Uno.</p>");
    } finally {
      editor.destroy();
    }
  });

  it("never removes typed text; a sentence begun by hand loses only its dictated tail", async () => {
    const { host, session } = setupSession();
    const editor = await makeEditor("<p>Hola</p>");
    try {
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
      await focusEditor(editor);
      await session.start();
      host.emitFinal("mundo punto");
      expect(editor.getHTML()).toBe("<p>Hola mundo.</p>");
      host.emitFinal("borra eso");
      expect(editor.getHTML()).toBe("<p>Hola</p>");
    } finally {
      editor.destroy();
    }
  });

  it("removes the last dictated line when there are no sentence ends", async () => {
    const { host, session } = setupSession();
    const editor = await makeEditor();
    try {
      await focusEditor(editor);
      await session.start();
      host.emitFinal("hola mundo");
      expect(editor.getHTML()).toBe("<p>Hola mundo</p>");
      host.emitFinal("borra eso");
      expect(editor.getHTML()).toBe("<p></p>");
    } finally {
      editor.destroy();
    }
  });

  it("does nothing when the author edited inside, and announces it", async () => {
    const notices: SessionNotice[] = [];
    const stats = createLineStats();
    const { host, session } = setupSession({ notices, stats });
    const editor = await makeEditor();
    try {
      await focusEditor(editor);
      await session.start();
      host.emitFinal("uno punto dos punto");
      expect(editor.getHTML()).toBe("<p>Uno. Dos.</p>");
      // Author edit inside the last dictated sentence.
      editor.commands.setTextSelection(editor.state.doc.content.size - 2);
      editor.commands.insertContent("X");
      const edited = editor.getHTML();
      expect(edited).toContain("X");
      host.emitFinal("borra eso");
      expect(editor.getHTML()).toBe(edited);
      expect(notices).toContainEqual({ kind: "scratch_refused" });
      expect(stats.summary().scratchCount).toBe(1);
      // The refused entry stays, so scratch keeps refusing instead of deleting older text.
      host.emitFinal("borra eso");
      expect(editor.getHTML()).toBe(edited);
    } finally {
      editor.destroy();
    }
  });

  it("maps dictated ranges through later transactions", async () => {
    const { host, session } = setupSession();
    const editor = await makeEditor();
    try {
      await focusEditor(editor);
      await session.start();
      host.emitFinal("mundo punto");
      expect(editor.getHTML()).toBe("<p>Mundo.</p>");
      // Author types before the dictated sentence; positions shift.
      editor.commands.setTextSelection(1);
      editor.commands.insertContent("Oye ");
      expect(editor.getHTML()).toBe("<p>Oye Mundo.</p>");
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
      host.emitFinal("borra eso");
      expect(editor.getHTML()).toBe("<p>Oye </p>");
    } finally {
      editor.destroy();
    }
  });

  it("resets history when the session moves to another editor", async () => {
    const { host, session } = setupSession();
    const first = await makeEditor();
    const second = await makeEditor();
    try {
      await focusEditor(first);
      await session.start();
      host.emitFinal("uno punto");
      expect(first.getHTML()).toBe("<p>Uno.</p>");
      await focusEditor(second);
      host.emitFinal("borra eso");
      expect(first.getHTML()).toBe("<p>Uno.</p>");
      expect(second.getHTML()).toBe("<p></p>");
      // Returning finds the first editor's history cleared.
      await focusEditor(first);
      host.emitFinal("borra eso");
      expect(first.getHTML()).toBe("<p>Uno.</p>");
    } finally {
      first.destroy();
      second.destroy();
    }
  });

  it("leaves scratch words inside prose alone", async () => {
    const { host, session } = setupSession();
    const editor = await makeEditor();
    try {
      await focusEditor(editor);
      await session.start();
      host.emitFinal("dije borra eso alto");
      expect(editor.getHTML()).toBe("<p>Dije borra eso alto</p>");
      host.emitFinal("borra eso");
      expect(editor.getHTML()).toBe("<p></p>");
    } finally {
      editor.destroy();
    }
  });

  it("keeps dictated history in the plugin state, mapped through typing", async () => {
    const { host, session } = setupSession();
    const editor = await makeEditor();
    try {
      await focusEditor(editor);
      await session.start();
      host.emitFinal("uno punto dos punto");
      const before = dictationPluginKey.getState(editor.state)?.history.length;
      expect(before).toBe(2);
      editor.commands.setTextSelection(1);
      editor.commands.insertContent("Oye ");
      const history = dictationPluginKey.getState(editor.state)?.history;
      expect(history?.length).toBe(2);
      expect(history?.[0].from).toBeGreaterThan(1);
    } finally {
      editor.destroy();
    }
  });

  it("removes a dictated paragraph's sentence, leaving an empty paragraph", async () => {
    const { host, session } = setupSession();
    const editor = await makeEditor();
    try {
      await focusEditor(editor);
      await session.start();
      host.emitFinal("hola punto y aparte mañana seguimos");
      expect(editor.getHTML()).toBe("<p>Hola.</p><p>Mañana seguimos</p>");
      host.emitFinal("borra eso");
      expect(editor.getHTML()).toBe("<p>Hola.</p><p></p>");
      host.emitFinal("borra eso");
      expect(editor.getHTML()).toBe("<p></p><p></p>");
    } finally {
      editor.destroy();
    }
  });

  it("scratches English sentences with scratch that", async () => {
    const { host, session, stats } = setupSession({ language: "en" });
    const editor = await makeEditor();
    try {
      await focusEditor(editor);
      await session.start();
      host.emitFinal("hello comma world period how are you question mark");
      expect(editor.getHTML()).toBe("<p>Hello, world. How are you?</p>");
      host.emitFinal("scratch that");
      expect(editor.getHTML()).toBe("<p>Hello, world.</p>");
      expect(stats.summary().scratchCount).toBe(1);
      host.emitFinal("Scratch that.");
      expect(editor.getHTML()).toBe("<p></p>");
    } finally {
      editor.destroy();
    }
  });
});
