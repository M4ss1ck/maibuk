import { Editor } from "@tiptap/core";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { undo, undoDepth } from "@tiptap/pm/history";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRichTextExtensions } from "@/components/editor/extensions/createRichTextExtensions";
import { attachSession, resetDictationHubForTests } from "@/features/dictation/hub";
import { buildPhraseTable, interpret } from "@/features/dictation/interpreter";
import { createRouter } from "@/features/dictation/router";
import { createDictationSession } from "@/features/dictation/session";
import { createLineStats } from "@/features/dictation/stats";
import type { DictationEvent, ModelSpec, RecognizerHost } from "@/features/dictation/types";

const model: ModelSpec = {
  id: "test-en",
  engine: "moonshine",
  languages: ["en"],
  tier: "fast",
  platforms: ["web"],
  files: [],
  engineOptions: {},
  capabilities: { casing: true, punctuation: true, streaming: true },
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

/** The list structure only: `[x]`/`[ ]` per Task Item, text per paragraph. */
function outline(node: ProseMirrorNode): string {
  if (node.isTextblock) return JSON.stringify(node.textContent);
  const children: string[] = [];
  node.forEach((child) => {
    children.push(outline(child));
  });
  const inner = children.join(" ");
  if (node.type.name === "taskItem") return `${node.attrs.checked ? "[x]" : "[ ]"}(${inner})`;
  if (node.type.name === "doc") return inner;
  return `${node.type.name}(${inner})`;
}

/** Caret at the end of the paragraph whose text is `text` (or the deepest empty one). */
function caretAt(editor: Editor, text: string): number {
  let found: number | null = null;
  let foundDepth = -1;
  editor.state.doc.descendants((node, pos) => {
    if (node.isTextblock && node.textContent === text) {
      const depth = editor.state.doc.resolve(pos + 1).depth;
      if (depth > foundDepth) {
        found = pos + 1 + node.content.size;
        foundDepth = depth;
      }
    }
    return true;
  });
  if (found === null) throw new Error(`paragraph ${JSON.stringify(text)} not found`);
  return found;
}

async function dictateInto(content: string, caretText: string) {
  const host = fakeHost();
  let state = { capitalizeNext: false, noSpaceNext: false, allCaps: false };
  const table = buildPhraseTable("en");
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
    stats: createLineStats(),
  });
  resetDictationHubForTests();
  attachSession(session);
  // The Notes and Quick Note schema: the shared rich text plus nested checklists.
  const editor = new Editor({
    extensions: [
      ...createRichTextExtensions({ spellCheck: { enabled: false, language: "en" } }),
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    content,
  });
  await new Promise<void>((resolve) => editor.on("create", () => resolve()));
  document.body.appendChild(editor.view.dom);
  editor.commands.setTextSelection(caretAt(editor, caretText));
  const focused = new Promise<void>((resolve) => editor.on("focus", () => resolve()));
  editor.commands.focus();
  await focused;
  await session.start();
  return { editor, host };
}

const task = (checked: boolean, inner: string) =>
  `<li data-type="taskItem" data-checked="${checked}"><label><input type="checkbox"></label><div>${inner}</div></li>`;
const taskList = (...items: string[]) => `<ul data-type="taskList">${items.join("")}</ul>`;

afterEach(() => resetDictationHubForTests());

describe("Dictation new item inside a checklist", () => {
  it("adds an unchecked Task Item to the same checklist instead of nesting a bulleted list", async () => {
    const { editor, host } = await dictateInto(
      taskList(task(true, "<p>Milk</p>"), task(false, "<p>Bread</p>")),
      "Milk"
    );
    try {
      const before = undoDepth(editor.state);
      host.emitFinal("new item eggs");
      expect(outline(editor.state.doc)).toBe(
        'taskList([x]("Milk") [ ]("Eggs") [ ]("Bread")) ""'
      );
      expect(undoDepth(editor.state)).toBe(before + 1);
      undo(editor.state, editor.view.dispatch);
      expect(outline(editor.state.doc)).toBe('taskList([x]("Milk") [ ]("Bread")) ""');
    } finally {
      editor.destroy();
    }
  });

  it("splits the Task Item at the caret like Enter, the new half unchecked", async () => {
    const { editor, host } = await dictateInto(taskList(task(true, "<p>Milk</p>")), "Milk");
    try {
      host.emitFinal("and butter new item");
      expect(outline(editor.state.doc)).toBe('taskList([x]("Milk and butter") [ ]("")) ""');
      // The caret is in the new item: the next line lands there.
      host.emitFinal("eggs");
      expect(outline(editor.state.doc)).toBe('taskList([x]("Milk and butter") [ ]("Eggs")) ""');
    } finally {
      editor.destroy();
    }
  });

  it("leaves the checklist from an empty Task Item like Enter instead of adding another", async () => {
    const { editor, host } = await dictateInto(
      `${taskList(task(false, "<p>Milk</p>"), task(false, "<p></p>"))}<p>After</p>`,
      ""
    );
    try {
      const before = undoDepth(editor.state);
      host.emitFinal("new item");
      expect(outline(editor.state.doc)).toBe('taskList([ ]("Milk")) "" "After"');
      expect(undoDepth(editor.state)).toBe(before + 1);
    } finally {
      editor.destroy();
    }
  });

  it("moves an empty nested Task Item up one level like Enter", async () => {
    const { editor, host } = await dictateInto(
      taskList(task(false, `<p>a</p>${taskList(task(true, "<p>b</p>"), task(false, "<p></p>"))}`)),
      ""
    );
    try {
      const before = undoDepth(editor.state);
      host.emitFinal("new item");
      expect(outline(editor.state.doc)).toBe('taskList([ ]("a" taskList([x]("b"))) [ ]("")) ""');
      expect(undoDepth(editor.state)).toBe(before + 1);
    } finally {
      editor.destroy();
    }
  });

  it("splits a quote inside a Task Item without turning the quote into a Task Item", async () => {
    const { editor, host } = await dictateInto(
      taskList(task(true, "<p>a</p><blockquote><p>b</p></blockquote>")),
      "b"
    );
    try {
      host.emitFinal("new item c");
      expect(outline(editor.state.doc)).toBe(
        'taskList([x]("a" blockquote("b") blockquote("C"))) ""'
      );
    } finally {
      editor.destroy();
    }
  });

  it("adds a bulleted item inside a nested bulleted list within a Task Item", async () => {
    const { editor, host } = await dictateInto(
      taskList(task(false, "<p>a</p><ul><li><p>b</p></li></ul>")),
      "b"
    );
    try {
      host.emitFinal("new item c");
      expect(outline(editor.state.doc)).toBe(
        'taskList([ ]("a" bulletList(listItem("b") listItem("C")))) ""'
      );
    } finally {
      editor.destroy();
    }
  });
});
