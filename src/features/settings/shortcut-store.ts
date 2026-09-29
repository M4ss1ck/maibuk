import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { DictationLanguage } from "@/features/dictation/types";
import {
  defaultVoicePhrases,
  isVoiceEligible,
  normalizeCustomVoiceCommands,
  normalizeVoicePhraseList,
  type CustomVoiceCommands,
} from "@/features/dictation/voice-commands";
import { normalizePhrase } from "@/features/dictation/normalize";
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
  /** An empty list is "No Voice Command"; the defaults again delete the entry. */
  setCommandVoicePhrases: (
    id: CommandId,
    language: DictationLanguage,
    phrases: readonly string[]
  ) => void;
  resetCommandVoicePhrases: (id: CommandId, language: DictationLanguage) => void;
  /** Resets every Custom Shortcut and custom Voice Command. */
  resetAllShortcuts: () => void;
  /** Loading a Shortcut File replaces both kinds of binding. */
  replaceCustomShortcuts: (custom: CustomShortcuts, voice?: CustomVoiceCommands) => void;
  setSingleKeyShortcutsEnabled: (enabled: boolean) => void;
}

function withCustom(settings: ShortcutSettings, custom: CustomShortcuts): ShortcutSettings {
  return { ...settings, custom };
}

function withVoice(settings: ShortcutSettings, voice: CustomVoiceCommands): ShortcutSettings {
  return { ...settings, voice };
}

function withoutLanguage(
  voice: CustomVoiceCommands,
  id: CommandId,
  language: DictationLanguage
): CustomVoiceCommands {
  const next = { ...voice };
  const { [language]: _removed, ...rest } = next[id] ?? {};
  if (Object.keys(rest).length === 0) delete next[id];
  else next[id] = rest;
  return next;
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
      setCommandVoicePhrases: (id, language, phrases) =>
        set((state) => {
          if (!isVoiceEligible(id)) return state;
          const next = normalizeVoicePhraseList(phrases);
          const defaults = defaultVoicePhrases(id, language);
          const isDefault =
            next.length === defaults.length &&
            next.every(
              (phrase, index) => normalizePhrase(phrase) === normalizePhrase(defaults[index])
            );
          const voice = isDefault
            ? withoutLanguage(state.shortcuts.voice, id, language)
            : {
                ...state.shortcuts.voice,
                [id]: { ...state.shortcuts.voice[id], [language]: next },
              };
          return { shortcuts: withVoice(state.shortcuts, voice) };
        }),
      resetCommandVoicePhrases: (id, language) =>
        set((state) => {
          if (state.shortcuts.voice[id]?.[language] === undefined) return state;
          return {
            shortcuts: withVoice(
              state.shortcuts,
              withoutLanguage(state.shortcuts.voice, id, language)
            ),
          };
        }),
      resetAllShortcuts: () =>
        set((state) => ({ shortcuts: { ...state.shortcuts, custom: {}, voice: {} } })),
      replaceCustomShortcuts: (custom, voice = {}) =>
        set((state) => ({
          shortcuts: {
            ...state.shortcuts,
            custom: normalizeShortcuts({ version: 1, custom }).custom,
            voice: normalizeCustomVoiceCommands(voice),
          },
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
