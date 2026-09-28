import { Editor } from "@tiptap/core";
import { undo, undoDepth } from "@tiptap/pm/history";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRichTextExtensions } from "@/components/editor/extensions/createRichTextExtensions";
import { BEFORE_CARET_LIMIT } from "@/components/editor/extensions/Dictation";
import { attachSession, resetDictationHubForTests } from "@/features/dictation/hub";
import { buildPhraseTable, interpret } from "@/features/dictation/interpreter";
import { createRouter } from "@/features/dictation/router";
import { createDictationSession } from "@/features/dictation/session";
import { createLineStats } from "@/features/dictation/stats";
import type { DictationEvent, ModelSpec, RecognizerHost } from "@/features/dictation/types";

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

afterEach(() => resetDictationHubForTests());

describe("Dictation line to rich-text document", () => {
  it("turns a Spanish spoken line into punctuated paragraphs as one undo step", async () => {
    const host = fakeHost();
    let state = { capitalizeNext: false, noSpaceNext: false };
    const table = buildPhraseTable("es");
    const stats = createLineStats();
    const session = createDictationSession({
      host,
      modelFor: () => model,
      route: createRouter((line, before) => {
        const next = interpret({ line, before, capabilities: model.capabilities, table, state });
        state = next.state;
        return { ...next.result, spokenPunctuationCount: next.spokenPunctuationCount };
      }),
      runCommand: vi.fn(),
      notify: vi.fn(),
      copyText: vi.fn(async () => {}),
      stats,
    });
    resetDictationHubForTests();
    attachSession(session);
    const editor = new Editor({
      extensions: createRichTextExtensions({ spellCheck: { enabled: false, language: "es" } }),
      content: "<p></p>",
    });
    try {
      await new Promise<void>((resolve) => editor.on("create", () => resolve()));
      document.body.appendChild(editor.view.dom);
      const focused = new Promise<void>((resolve) => editor.on("focus", () => resolve()));
      editor.commands.focus();
      await focused;
      await session.start();
      host.emitFinal("hola coma cómo estás punto y aparte mañana seguimos");
      expect(editor.getHTML()).toBe("<p>Hola, cómo estás.</p><p>Mañana seguimos</p>");
      expect(undoDepth(editor.state)).toBe(1);
      expect(stats.summary().spokenPunctuationCount).toBe(2);
      undo(editor.state, editor.view.dispatch);
      expect(editor.getHTML()).toBe("<p></p>");
    } finally {
      editor.destroy();
    }
  });

  it("routes two final lines into separate undo steps and exposes bounded context", async () => {
    const host = fakeHost();
    const before: string[] = [];
    const session = createDictationSession({
      host,
      modelFor: () => model,
      route: createRouter((text, context) => {
        before.push(context);
        return { kind: "edits", edits: [{ kind: "text", text }] };
      }),
      runCommand: vi.fn(),
      notify: vi.fn(),
      copyText: vi.fn(async () => {}),
      stats: createLineStats(),
    });
    resetDictationHubForTests();
    attachSession(session);
    const editor = new Editor({
      extensions: createRichTextExtensions({ spellCheck: { enabled: false, language: "es" } }),
      content: `<p>${"a".repeat(BEFORE_CARET_LIMIT + 40)}</p>`,
    });
    try {
      await new Promise<void>((resolve) => editor.on("create", () => resolve()));
      document.body.appendChild(editor.view.dom);
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
      const focused = new Promise<void>((resolve) => editor.on("focus", () => resolve()));
      editor.commands.focus();
      await focused;
      await session.start();
      host.emitFinal("uno");
      expect(editor.getHTML()).toBe(`<p>${"a".repeat(BEFORE_CARET_LIMIT + 40)} uno</p>`);
      expect(undoDepth(editor.state)).toBe(1);
      host.emitFinal("dos");
      expect(editor.getHTML()).toBe(`<p>${"a".repeat(BEFORE_CARET_LIMIT + 40)} uno dos</p>`);
      expect(undoDepth(editor.state)).toBe(2);
      expect(before).toEqual([
        "a".repeat(BEFORE_CARET_LIMIT),
        `${"a".repeat(BEFORE_CARET_LIMIT - 4)} uno`,
      ]);
      undo(editor.state, editor.view.dispatch);
      expect(editor.getHTML()).toBe(`<p>${"a".repeat(BEFORE_CARET_LIMIT + 40)} uno</p>`);
    } finally {
      editor.destroy();
    }
  });
});
