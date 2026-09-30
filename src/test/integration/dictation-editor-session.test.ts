import { Editor } from "@tiptap/core";
import { undo, undoDepth } from "@tiptap/pm/history";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRichTextExtensions } from "@/components/editor/extensions/createRichTextExtensions";
import { BEFORE_CARET_LIMIT } from "@/components/editor/extensions/Dictation";
import { attachSession, resetDictationHubForTests } from "@/features/dictation/hub";
import { buildPhraseTable, interpret } from "@/features/dictation/interpreter";
import { createRouter } from "@/features/dictation/router";
import { createDictationSession } from "@/features/dictation/session";
import { defaultSpokenPunctuationLanguageSettings } from "@/features/dictation/spoken-punctuation";
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
    let state = { capitalizeNext: false, noSpaceNext: false, allCaps: false };
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

  it("starts a bulleted list outside one and splits inside one, each as one undo step", async () => {
    const host = fakeHost();
    let state = { capitalizeNext: false, noSpaceNext: false, allCaps: false };
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
      host.emitFinal("primero nuevo elemento segundo");
      // TipTap keeps a trailing paragraph after a list, like toggleBulletList does.
      expect(editor.getHTML()).toBe("<p>Primero</p><ul><li><p>Segundo</p></li></ul><p></p>");
      expect(undoDepth(editor.state)).toBe(1);
      expect(stats.summary().spokenPunctuationCount).toBe(1);
      // Inside the new list item, a spoken item splits it again as one more step.
      // The caret stayed in the list item; the trailing paragraph is TipTap's.
      host.emitFinal("tercero nuevo elemento cuarto");
      expect(editor.getHTML()).toBe(
        "<p>Primero</p><ul><li><p>Segundo tercero</p></li><li><p>Cuarto</p></li></ul><p></p>"
      );
      expect(undoDepth(editor.state)).toBe(2);
      undo(editor.state, editor.view.dispatch);
      expect(editor.getHTML()).toBe("<p>Primero</p><ul><li><p>Segundo</p></li></ul><p></p>");
    } finally {
      editor.destroy();
    }
  });

  it("inserts Spanish openers automatically, explicitly, and across lines as one undo step", async () => {
    const host = fakeHost();
    let state = { capitalizeNext: false, noSpaceNext: false, allCaps: false };
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
      host.emitFinal("cómo estás signo de interrogación");
      expect(editor.getHTML()).toBe("<p>¿Cómo estás?</p>");
      expect(undoDepth(editor.state)).toBe(1);
      undo(editor.state, editor.view.dispatch);
      expect(editor.getHTML()).toBe("<p></p>");
      state = { capitalizeNext: false, noSpaceNext: false, allCaps: false };
      host.emitFinal("si vienes abre interrogación me avisas cierra interrogación");
      expect(editor.getHTML()).toBe("<p>Si vienes ¿me avisas?</p>");
      expect(undoDepth(editor.state)).toBe(1);
      // Across two finished lines: the question starts in the first line and
      // closes in the second, so the opener goes at its sentence start.
      editor.commands.setContent("<p></p>");
      state = { capitalizeNext: false, noSpaceNext: false, allCaps: false };
      host.emitFinal("qué hora");
      expect(editor.getHTML()).toBe("<p>Qué hora</p>");
      host.emitFinal("es cierra interrogación");
      expect(editor.getHTML()).toBe("<p>¿Qué hora es?</p>");
    } finally {
      editor.destroy();
    }
  });

  it("places the auto opener after a hard break, not at the paragraph start", async () => {
    const host = fakeHost();
    let state = { capitalizeNext: false, noSpaceNext: false, allCaps: false };
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
      notify: vi.fn(),
      copyText: vi.fn(async () => {}),
      stats,
    });
    resetDictationHubForTests();
    attachSession(session);
    const editor = new Editor({
      extensions: createRichTextExtensions({ spellCheck: { enabled: false, language: "es" } }),
      content: "<p>Hola</p>",
    });
    try {
      await new Promise<void>((resolve) => editor.on("create", () => resolve()));
      document.body.appendChild(editor.view.dom);
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
      const focused = new Promise<void>((resolve) => editor.on("focus", () => resolve()));
      editor.commands.focus();
      await focused;
      await session.start();
      host.emitFinal("nueva línea qué hora es signo de interrogación");
      expect(editor.getHTML()).toBe("<p>Hola<br>¿Qué hora es?</p>");
      expect(undoDepth(editor.state)).toBe(1);
    } finally {
      editor.destroy();
    }
  });

  it("places the auto opener inside opening quotes and parentheses", async () => {
    const host = fakeHost();
    let state = { capitalizeNext: false, noSpaceNext: false, allCaps: false };
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
      host.emitFinal("abre comillas qué es cierra interrogación cierra comillas");
      expect(editor.getHTML()).toBe("<p>«¿Qué es?»</p>");
      expect(undoDepth(editor.state)).toBe(1);
    } finally {
      editor.destroy();
    }
  });

  it("turns an empty paragraph into the list item instead of leaving it above", async () => {
    const host = fakeHost();
    let state = { capitalizeNext: false, noSpaceNext: false, allCaps: false };
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
      host.emitFinal("nuevo elemento hola");
      expect(editor.getHTML()).toBe("<ul><li><p>Hola</p></li></ul><p></p>");
      expect(undoDepth(editor.state)).toBe(1);
    } finally {
      editor.destroy();
    }
  });

  it("lifts out of an empty list item like Enter instead of adding another", async () => {
    const host = fakeHost();
    let state = { capitalizeNext: false, noSpaceNext: false, allCaps: false };
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
      notify: vi.fn(),
      copyText: vi.fn(async () => {}),
      stats,
    });
    resetDictationHubForTests();
    attachSession(session);
    const editor = new Editor({
      extensions: createRichTextExtensions({ spellCheck: { enabled: false, language: "es" } }),
      content: "<ul><li><p>Hola</p></li><li><p></p></li></ul><p></p>",
    });
    try {
      await new Promise<void>((resolve) => editor.on("create", () => resolve()));
      document.body.appendChild(editor.view.dom);
      let emptyPos: number | null = null;
      editor.state.doc.descendants((node, pos) => {
        if (emptyPos !== null) return false;
        if (node.type.name === "paragraph" && node.textContent === "") {
          const $p = editor.state.doc.resolve(pos + 1);
          for (let d = $p.depth; d > 0; d -= 1) {
            if ($p.node(d).type.name === "listItem") {
              emptyPos = pos + 1;
              break;
            }
          }
        }
        return true;
      });
      expect(emptyPos).not.toBeNull();
      if (emptyPos === null) throw new Error("empty list item not found");
      editor.commands.setTextSelection(emptyPos);
      const focused = new Promise<void>((resolve) => editor.on("focus", () => resolve()));
      editor.commands.focus();
      await focused;
      await session.start();
      host.emitFinal("nuevo elemento");
      expect(editor.getHTML()).toBe("<ul><li><p>Hola</p></li></ul><p></p><p></p>");
      expect(undoDepth(editor.state)).toBe(1);
    } finally {
      editor.destroy();
    }
  });

  it("moves an empty nested item up one list level like Enter", async () => {
    const host = fakeHost();
    let state = { capitalizeNext: false, noSpaceNext: false, allCaps: false };
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
      notify: vi.fn(),
      copyText: vi.fn(async () => {}),
      stats,
    });
    resetDictationHubForTests();
    attachSession(session);
    const editor = new Editor({
      extensions: createRichTextExtensions({ spellCheck: { enabled: false, language: "es" } }),
      content: "<ul><li><p>a</p><ul><li><p>b</p></li><li><p></p></li></ul></li></ul><p></p>",
    });
    try {
      await new Promise<void>((resolve) => editor.on("create", () => resolve()));
      document.body.appendChild(editor.view.dom);
      // Caret into the nested empty item: the deepest empty paragraph in a list item.
      let emptyPos: number | null = null;
      let emptyDepth = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "paragraph" && node.textContent === "") {
          const $p = editor.state.doc.resolve(pos + 1);
          for (let d = $p.depth; d > 0; d -= 1) {
            if ($p.node(d).type.name === "listItem" && $p.depth > emptyDepth) {
              emptyPos = pos + 1;
              emptyDepth = $p.depth;
              break;
            }
          }
        }
        return true;
      });
      expect(emptyPos).not.toBeNull();
      if (emptyPos === null) throw new Error("empty nested list item not found");
      editor.commands.setTextSelection(emptyPos);
      const focused = new Promise<void>((resolve) => editor.on("focus", () => resolve()));
      editor.commands.focus();
      await focused;
      await session.start();
      host.emitFinal("nuevo elemento");
      expect(editor.getHTML()).toBe(
        "<ul><li><p>a</p><ul><li><p>b</p></li></ul></li><li><p></p></li></ul><p></p>"
      );
      expect(undoDepth(editor.state)).toBe(1);
    } finally {
      editor.destroy();
    }
  });

  it("capitalizes with mayúscula and writes punctuation words with literal as one undo step", async () => {
    const host = fakeHost();
    let state = { capitalizeNext: false, noSpaceNext: false, allCaps: false };
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
      host.emitFinal("hola mayúscula maría di literal coma por favor");
      expect(editor.getHTML()).toBe("<p>Hola María di coma por favor</p>");
      expect(undoDepth(editor.state)).toBe(1);
      expect(stats.summary().spokenPunctuationCount).toBe(2);
    } finally {
      editor.destroy();
    }
  });

  it("honors the author's Spoken Punctuation settings as one undo step", async () => {
    const host = fakeHost();
    let state = { capitalizeNext: false, noSpaceNext: false, allCaps: false };
    const settings = defaultSpokenPunctuationLanguageSettings();
    settings.entries.coma = false;
    settings.aliases.puntoYAparte = ["punto y la parte"];
    settings.aliases.borraEso = ["bórralo"];
    const table = buildPhraseTable("es", { settings, capabilities: model.capabilities });
    const stats = createLineStats();
    const session = createDictationSession({
      host,
      modelFor: () => model,
      route: createRouter((line, before) => {
        const next = interpret({ line, before, capabilities: model.capabilities, table, state });
        state = next.state;
        return { ...next.result, spokenPunctuationCount: next.spokenPunctuationCount };
      }),
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
      // "coma" is switched off and "punto y la parte" is the author's alias.
      host.emitFinal("hola coma cómo estás punto y la parte mañana");
      expect(editor.getHTML()).toBe("<p>Hola coma cómo estás.</p><p>Mañana</p>");
      expect(undoDepth(editor.state)).toBe(1);
      expect(stats.summary().spokenPunctuationCount).toBe(1);
      // The alias works for scratch that too, and never reaches the text.
      host.emitFinal("bórralo.");
      expect(editor.getHTML()).toBe("<p>Hola coma cómo estás.</p><p></p>");
      expect(undoDepth(editor.state)).toBe(2);
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
