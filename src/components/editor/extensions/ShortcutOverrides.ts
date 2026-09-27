import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { isMac } from "@/lib/platform/detect";
import { useShortcutSettingsStore } from "@/features/settings/shortcut-store";
import { liveShortcuts } from "@/lib/command-keys";
import {
  COMMAND_IDS,
  COMMANDS,
  type CommandDef,
  type CommandId,
  type Step,
} from "@/lib/shortcut-registry";
import { isIgnoredKeyEvent, isTypingSafe, shortcutKey, stepsFromEvent } from "@/lib/shortcut-keys";
import { defaultShortcuts, type ShortcutSettings } from "@/lib/shortcut-resolve";
import { EDITOR_COMMANDS } from "@/components/editor/editor-commands";

const SEQUENCE_TIMEOUT_MS = 600;

const EDITOR_KEYMAP_IDS = COMMAND_IDS.filter((id) => {
  const definition: CommandDef = COMMANDS[id];
  return definition.source === "editor-keymap" && EDITOR_COMMANDS[id];
});

interface Bindings {
  /** Custom Shortcuts: the extensions' keymaps do not know these keys. */
  singles: Map<Step, CommandId>;
  sequences: Map<Step, Map<Step, CommandId>>;
  /** Default keys the author moved away from, which must no longer reach the extensions. */
  retired: Set<Step>;
}

function buildBindings(settings: ShortcutSettings): Bindings {
  const singles = new Map<Step, CommandId>();
  const sequences = new Map<Step, Map<Step, CommandId>>();
  const retired = new Set<Step>();
  const live = new Set<string>();

  for (const id of EDITOR_KEYMAP_IDS) {
    const definition: CommandDef = COMMANDS[id];
    const builtIn = new Set(
      [...(definition.fixed ?? []), ...defaultShortcuts(id, false)].map(shortcutKey)
    );
    for (const shortcut of liveShortcuts(id, settings)) {
      live.add(shortcutKey(shortcut));
      if (builtIn.has(shortcutKey(shortcut))) continue;
      // A bare letter here would eat the author's typing.
      if (!isTypingSafe(shortcut)) continue;
      if (shortcut.length === 1) singles.set(shortcut[0], id);
      else {
        const seconds = sequences.get(shortcut[0]) ?? new Map<Step, CommandId>();
        seconds.set(shortcut[1], id);
        sequences.set(shortcut[0], seconds);
      }
    }
  }

  for (const id of EDITOR_KEYMAP_IDS) {
    for (const shortcut of defaultShortcuts(id, false)) {
      if (shortcut.length === 1 && !live.has(shortcutKey(shortcut))) retired.add(shortcut[0]);
    }
  }

  return { singles, sequences, retired };
}

/**
 * Runs `editor-keymap` Commands on the author's Custom Shortcuts and retires
 * the default keys they moved away from, without re-creating the editor: the
 * keys are read from settings when a key is pressed (ADR 0012). Priority above
 * the default 100 puts this plugin ahead of every extension's own keymap.
 */
export const ShortcutOverrides = Extension.create({
  name: "shortcutOverrides",
  priority: 1000,

  addProseMirrorPlugins() {
    const editor = this.editor;
    let cachedSettings: ShortcutSettings | null = null;
    let cached: Bindings | null = null;
    let pending: { step: Step; time: number } | null = null;

    const bindings = () => {
      const settings = useShortcutSettingsStore.getState().shortcuts;
      if (settings !== cachedSettings || !cached) {
        cachedSettings = settings;
        cached = buildBindings(settings);
      }
      return cached;
    };

    return [
      new Plugin({
        key: new PluginKey("shortcutOverrides"),
        props: {
          handleKeyDown: (_view, event) => {
            if (isIgnoredKeyEvent(event)) return false;
            const steps = stepsFromEvent(event, isMac());
            if (steps.length === 0) return false;
            const { singles, sequences, retired } = bindings();
            const now = Date.now();

            const previous = pending;
            pending = null;
            if (previous && now - previous.time <= SEQUENCE_TIMEOUT_MS) {
              const seconds = sequences.get(previous.step);
              const id = steps.map((step) => seconds?.get(step)).find(Boolean);
              if (id) {
                EDITOR_COMMANDS[id]?.(editor);
                return true;
              }
            }

            for (const step of steps) {
              if (sequences.has(step)) {
                pending = { step, time: now };
                return true;
              }
              const id = singles.get(step);
              if (id) {
                EDITOR_COMMANDS[id]?.(editor);
                return true;
              }
            }

            // Returning true stops the extensions' keymaps and prevents the default.
            return steps.some((step) => retired.has(step));
          },
        },
      }),
    ];
  },
});
