import {
  commandLabel,
  getCommand,
  isPluginCommandDef,
  isSealedCommand,
  type CommandId,
} from "@/lib/shortcut-registry";
import { voicePhrases, type CustomVoiceCommands } from "@/features/dictation/voice-commands";
import type { DictationLanguage } from "@/features/dictation/types";
import type { PaletteItem, PaletteTranslate } from "@/features/command-palette/palette-index";

export interface BuildCommandItemsOptions {
  /** Every bound Command and its state, read before the palette opened. */
  snapshot: ReadonlyMap<CommandId, "runnable" | "disabled">;
  /** Labels and keyword lists; the caller's `t` cast to accept registry keys. */
  t: PaletteTranslate;
  /** The UI language; both app languages take Voice Commands. */
  language: DictationLanguage;
  customVoice: CustomVoiceCommands;
}

function keywordsOf(t: BuildCommandItemsOptions["t"], key: string): string[] {
  const raw = t(key, { returnObjects: true });
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is string => typeof entry === "string");
}

/**
 * One palette item per listed Command. Only Commands are built here; Books,
 * Chapters, Notes, Canvases, nested pages, Settings rows, and entry-point
 * buttons arrive in later slices through their own builders beside this one.
 */
export function buildCommandItems({
  snapshot,
  t,
  language,
  customVoice,
}: BuildCommandItemsOptions): PaletteItem[] {
  const items: PaletteItem[] = [];
  for (const [id, state] of snapshot) {
    if (id.startsWith("focus.")) continue;
    if (isSealedCommand(id)) continue;
    const definition = getCommand(id);
    if (id === "global.openCommandPalette") continue;
    if (definition.contexts.includes("commandPalette")) continue;
    const terms: string[] = [...voicePhrases(id, language, customVoice)];
    if (isPluginCommandDef(definition)) {
      for (const term of definition.keywords ?? []) terms.push(term);
    } else if (definition.keywordsKey) {
      for (const term of keywordsOf(t, definition.keywordsKey)) terms.push(term);
    }
    const label = commandLabel(id, t, language);
    items.push({
      key: `command:${id}`,
      kind: "command",
      id,
      label: typeof label === "string" ? label : id,
      terms,
      state,
    });
  }
  return items;
}
