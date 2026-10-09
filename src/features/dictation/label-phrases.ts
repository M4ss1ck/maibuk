// Derived Voice Command phrases from Command labels (ADR 0016): a Command
// without its own phrases answers to its name, read from that Dictation
// Language's locale file, never from the UI language. Pure: no React, no
// i18next instance, so the bench and Node can use it.
import en from "@/locales/en.json";
import es from "@/locales/es.json";
import type { DictationLanguage } from "@/features/dictation/types";
import { getCommand, isPluginCommandDef, type CommandId } from "@/lib/shortcut-registry";

const LOCALES: Readonly<Record<DictationLanguage, unknown>> = { en, es };

function lookupKey(root: unknown, key: string): unknown {
  let current = root;
  for (const part of key.split(".")) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * The Command's label in the Dictation Language, or null when there is none.
 * A Plugin Command answers only for the languages its declaration supplies: an
 * English-only Plugin never acquires a Spanish phrase from a label fallback
 * (ADR 0024). Core Commands read the label from the Dictation Language's
 * locale; a key that is missing, not a string, or interpolates (a label like
 * `Look up "{{word}}"`) is never a spoken phrase.
 */
export function labelPhrase(id: CommandId, language: DictationLanguage): string | null {
  const definition = getCommand(id);
  if (isPluginCommandDef(definition)) {
    const supplied =
      definition.labels[language] ??
      (definition.defaultLanguage === language ? definition.label : undefined);
    return supplied ?? null;
  }
  const value = lookupKey(LOCALES[language], definition.labelKey);
  if (typeof value !== "string") return null;
  if (value.includes("{{")) return null;
  return value;
}

/**
 * Commands whose label never acts as a Voice Command, each with the reason
 * why no sensible explicit phrase exists. Only for that case: any Command
 * that can name its action carries explicit phrases instead.
 */
export const VOICE_LABEL_EXCLUSIONS: Readonly<Partial<Record<CommandId, string>>> = {};
