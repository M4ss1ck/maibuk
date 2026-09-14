import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Editor, type Extensions } from "@tiptap/core";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { afterEach, describe, expect, it, vi } from "vitest";
import { editorKeymapShortcutIds } from "@/components/editor/keymap-shortcuts";
import { createRichTextExtensions } from "@/components/editor/extensions/createRichTextExtensions";
import { SHORTCUTS, type ShortcutDef, type ShortcutId } from "@/lib/shortcut-registry";

vi.mock("@/components/editor/extensions/SpellCheck", async () => {
  const { Extension } = await vi.importActual<typeof import("@tiptap/core")>("@tiptap/core");
  return { SpellCheck: Extension.create({ name: "mockSpellCheck" }) };
});

const SRC = join(process.cwd(), "src");
const ALL_IDS = Object.keys(SHORTCUTS) as ShortcutId[];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === "test" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry) ? [path] : [];
  });
}

/** Ids that some `useShortcuts` entry (`id: "…"`) or `useBoundShortcutIds([...])` call declares. */
function declaredBindings(): Set<string> {
  const declared = new Set<string>();
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/\bid:\s*"([a-z]+\.[A-Za-z0-9]+)"/g)) declared.add(match[1]);
    for (const call of text.matchAll(/useBoundShortcutIds\(\s*\[([^\]]*)\]/g)) {
      for (const match of call[1].matchAll(/"([a-z]+\.[A-Za-z0-9]+)"/g)) declared.add(match[1]);
    }
  }
  return declared;
}

function buildEditor(extra: Extensions = []) {
  return new Editor({
    extensions: [
      ...createRichTextExtensions({
        onMarkdownPaste: () => {},
        footnoteStartIndex: 1,
        spellCheck: { enabled: false, language: "en" },
        autoClose: true,
        dropcursor: false,
      } as Parameters<typeof createRichTextExtensions>[0]),
      ...extra,
    ],
  });
}

describe("every registry shortcut is really bound", () => {
  const editors: Editor[] = [];
  afterEach(() => {
    for (const editor of editors.splice(0)) editor.destroy();
  });

  it("binds every shortcut the editor keymap does not handle somewhere in the app", () => {
    const declared = declaredBindings();
    const unbound = ALL_IDS.filter((id) => {
      const definition: ShortcutDef = SHORTCUTS[id];
      return definition.source !== "editor-keymap" && !declared.has(id);
    });

    expect(unbound).toEqual([]);
  });

  it("finds every editor-keymap shortcut in the keymap of an editor the app builds", () => {
    const chapterEditor = buildEditor();
    const noteEditor = buildEditor([TaskList, TaskItem.configure({ nested: true })]);
    editors.push(chapterEditor, noteEditor);
    const handled = new Set([
      ...editorKeymapShortcutIds(chapterEditor),
      ...editorKeymapShortcutIds(noteEditor),
    ]);

    const dead = ALL_IDS.filter((id) => {
      const definition: ShortcutDef = SHORTCUTS[id];
      return definition.source === "editor-keymap" && !handled.has(id);
    });

    expect(dead).toEqual([]);
  });

  it("does not list task lists in an editor without them", () => {
    const chapterEditor = buildEditor();
    editors.push(chapterEditor);

    const ids = editorKeymapShortcutIds(chapterEditor);

    expect(ids).toContain("editor.bold");
    expect(ids).toContain("editor.redo");
    expect(ids).not.toContain("editor.taskList");
  });
});
