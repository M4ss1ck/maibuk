import { create } from "zustand";
import { persist } from "zustand/middleware";
import { IS_WEB } from "@/lib/platform/target";
import { COMMANDS, type CommandDef, type CommandId, type Shortcut } from "@/lib/shortcut-registry";
import { normalizeShortcut, shortcutKey } from "@/lib/shortcut-keys";
import {
  DEFAULT_SHORTCUT_SETTINGS,
  editableShortcuts,
  normalizeShortcuts,
  type CustomShortcuts,
  type ShortcutSettings,
} from "@/lib/shortcut-resolve";

export const SHORTCUT_STORAGE_KEY = "maibuk-shortcuts";

interface ShortcutSettingsStore {
  shortcuts: ShortcutSettings;
  /** An empty list is "No shortcut"; the defaults again delete the entry. */
  setCommandShortcuts: (id: CommandId, shortcuts: readonly Shortcut[]) => void;
  resetCommandShortcuts: (id: CommandId) => void;
  resetAllShortcuts: () => void;
  replaceCustomShortcuts: (custom: CustomShortcuts) => void;
  setSingleKeyShortcutsEnabled: (enabled: boolean) => void;
}

function withCustom(settings: ShortcutSettings, custom: CustomShortcuts): ShortcutSettings {
  return { ...settings, custom };
}

/**
 * Custom Shortcuts and the Single-key Shortcuts switch, kept on this device
 * only (ADR 0012). A store of its own, so everything that shows or matches keys
 * depends on this and not on the whole settings module.
 */
export const useShortcutSettingsStore = create<ShortcutSettingsStore>()(
  persist(
    (set) => ({
      shortcuts: structuredClone(DEFAULT_SHORTCUT_SETTINGS),
      setCommandShortcuts: (id, shortcuts) =>
        set((state) => {
          const command: CommandDef = COMMANDS[id];
          if (command.sealed) return state;

          const seen = new Set<string>();
          const next: Shortcut[] = [];
          for (const shortcut of shortcuts) {
            const normalized = normalizeShortcut(shortcut);
            if (normalized === null || seen.has(shortcutKey(normalized))) continue;
            seen.add(shortcutKey(normalized));
            next.push(normalized);
          }

          const defaults = editableShortcuts(id, {}, IS_WEB);
          const isDefault =
            next.length === defaults.length &&
            next.every((shortcut, index) => shortcutKey(shortcut) === shortcutKey(defaults[index]));

          const custom = { ...state.shortcuts.custom };
          if (isDefault) delete custom[id];
          else custom[id] = next;
          return { shortcuts: withCustom(state.shortcuts, custom) };
        }),
      resetCommandShortcuts: (id) =>
        set((state) => {
          if (state.shortcuts.custom[id] === undefined) return state;
          const custom = { ...state.shortcuts.custom };
          delete custom[id];
          return { shortcuts: withCustom(state.shortcuts, custom) };
        }),
      resetAllShortcuts: () => set((state) => ({ shortcuts: withCustom(state.shortcuts, {}) })),
      replaceCustomShortcuts: (custom) =>
        set((state) => ({
          shortcuts: withCustom(
            state.shortcuts,
            normalizeShortcuts({ version: 1, custom, singleKeyEnabled: true }).custom
          ),
        })),
      setSingleKeyShortcutsEnabled: (enabled) =>
        set((state) => ({ shortcuts: { ...state.shortcuts, singleKeyEnabled: enabled } })),
    }),
    {
      name: SHORTCUT_STORAGE_KEY,
      partialize: (state) => ({ shortcuts: state.shortcuts }),
      // Whatever is stored (an older shape, a hand-edited value) is normalized
      // before any key reads it.
      merge: (persisted, current) => ({
        ...current,
        shortcuts: normalizeShortcuts(
          (persisted as { shortcuts?: unknown } | undefined)?.shortcuts
        ),
      }),
    }
  )
);
