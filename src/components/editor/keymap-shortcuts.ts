import { type Editor, getExtensionField, getSchemaTypeByName } from "@tiptap/core";
import { SHORTCUTS, type ShortcutDef, type ShortcutId } from "@/lib/shortcut-registry";

// Registry shortcuts tagged `editor-keymap` are handled by TipTap extensions,
// and which extensions an editor loads differs (Notes add task lists, Chapters
// do not). Reading the editor's own keymap keeps the help truthful per editor.

function normalize(parts: string[]): string {
  const lowered = parts.map((part) => {
    const lower = part.toLowerCase();
    return lower === "mod" || lower === "meta" || lower === "cmd" ? "ctrl" : lower;
  });
  const key = lowered[lowered.length - 1];
  const modifiers = lowered.slice(0, -1).sort();
  return [...modifiers, key].join("+");
}

/** "Mod-Shift-s", "Shift-Mod-z", "Mod--" into one comparable form. */
function fromKeymapKey(key: string): string {
  if (key.endsWith("--")) return normalize([...key.slice(0, -2).split("-"), "-"]);
  return normalize(key.split("-"));
}

/** "Ctrl+Shift+S", "Ctrl++" into the same form. */
function fromRegistryKey(combination: string): string {
  const parts = combination.split("+").filter(Boolean);
  if (combination.endsWith("+")) parts.push("+");
  return normalize(parts);
}

export function editorKeymapCombos(editor: Editor): Set<string> {
  const combos = new Set<string>();
  for (const extension of editor.extensionManager.extensions) {
    const addKeyboardShortcuts = getExtensionField<(() => Record<string, unknown>) | undefined>(
      extension,
      "addKeyboardShortcuts",
      {
        name: extension.name,
        options: extension.options,
        storage: editor.extensionStorage[extension.name as keyof typeof editor.extensionStorage],
        editor,
        type: getSchemaTypeByName(extension.name, editor.schema),
      }
    );
    if (!addKeyboardShortcuts) continue;
    for (const key of Object.keys(addKeyboardShortcuts())) combos.add(fromKeymapKey(key));
  }
  return combos;
}

/** The `editor-keymap` registry shortcuts this editor's extensions actually handle. */
export function editorKeymapShortcutIds(editor: Editor): ShortcutId[] {
  const combos = editorKeymapCombos(editor);
  return (Object.keys(SHORTCUTS) as ShortcutId[]).filter((id) => {
    const definition: ShortcutDef = SHORTCUTS[id];
    if (definition.source !== "editor-keymap" || !("keys" in definition)) return false;
    return definition.keys.every((combination) => combos.has(fromRegistryKey(combination)));
  });
}
