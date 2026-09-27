import { type Editor, getExtensionField, getSchemaTypeByName } from "@tiptap/core";
import { COMMAND_IDS, COMMANDS, type CommandDef, type CommandId } from "@/lib/shortcut-registry";

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

/** "Mod+Shift+s", "Mod++" into the same form. */
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

/**
 * The `editor-keymap` Commands this editor's extensions actually handle. It
 * checks the built-in keys, which only say whether the extension is loaded;
 * the keys that fire are the Command's live Shortcuts.
 */
export function editorKeymapShortcutIds(editor: Editor): CommandId[] {
  const combos = editorKeymapCombos(editor);
  return COMMAND_IDS.filter((id) => {
    const definition: CommandDef = COMMANDS[id];
    if (definition.source !== "editor-keymap") return false;
    const builtIn = [...(definition.fixed ?? []), ...definition.defaults];
    return (
      builtIn.length > 0 &&
      builtIn.every((shortcut) => shortcut.length === 1 && combos.has(fromRegistryKey(shortcut[0])))
    );
  });
}
