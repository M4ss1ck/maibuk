// The one phrase conflict check (ADR 0014): a spoken phrase means one thing
// per Dictation Language. It covers a Voice Command against another Command's
// Voice Commands (when their Shortcut Contexts overlap), a Voice Command
// against Spoken Punctuation phrases and aliases, an alias against every
// Voice Command, and anything that starts with the escape word. The Shortcut
// Editor, Settings → Dictation, and Shortcut File loading all refuse through
// it.
import { normalizePhrase, phraseWords } from "@/features/dictation/normalize";
import {
  defaultSpokenPunctuationLanguageSettings,
  entriesFor,
  findAliasRefusal,
  type AliasRefusal,
  type SpokenPunctuationLanguageSettings,
} from "@/features/dictation/spoken-punctuation";
import type { DictationLanguage } from "@/features/dictation/types";
import {
  MIN_VOICE_PHRASE_WORDS,
  buildVoiceCommandTable,
  voiceCommandMatches,
  voiceEligibleCommands,
  voicePhrases,
  type CustomVoiceCommands,
} from "@/features/dictation/voice-commands";
import { COMMANDS, type CommandDef, type CommandId } from "@/lib/shortcut-registry";
import { contextsOverlap } from "@/lib/shortcut-resolve";

export type PhraseConflict =
  | AliasRefusal
  /** A Voice Command of one word would fire on one-word sentences. */
  | { kind: "tooShort" }
  /** The Command already answers to this phrase. */
  | { kind: "voiceDuplicate"; phrase: string }
  /** Another Command's Voice Command answers to it. */
  | { kind: "voiceCommand"; commandId: CommandId; phrase: string };

/** What the phrase would become: a Voice Command of a Command, or an extra Spoken Punctuation phrase. */
export type PhraseCandidate =
  | {
      kind: "voice";
      id: CommandId /** The phrase being edited, which the check ignores. */;
      replacing?: string;
    }
  | { kind: "alias"; entryId: string };

export interface PhraseConflictOptions {
  language: DictationLanguage;
  phrase: string;
  candidate: PhraseCandidate;
  /** The author's custom Voice Commands. */
  voice: CustomVoiceCommands;
  /** The Spoken Punctuation settings of the language: their aliases count too. */
  spokenPunctuation?: SpokenPunctuationLanguageSettings;
}

function contextsOf(id: CommandId) {
  return (COMMANDS[id] as CommandDef).contexts;
}

function isLiteralEntryId(language: DictationLanguage, entryId: string): boolean {
  return (
    entriesFor(language)
      .find((entry) => entry.id === entryId)
      ?.actions.some((action) => action.kind === "literal") ?? false
  );
}

function voiceConflict(
  options: PhraseConflictOptions & { candidate: { kind: "voice" } }
): PhraseConflict | null {
  const { language, phrase, candidate, voice } = options;
  const settings = options.spokenPunctuation ?? defaultSpokenPunctuationLanguageSettings();
  const normalized = normalizePhrase(phrase);
  if (normalized === "") return { kind: "empty" };
  const words = normalized.split(" ");
  if (words.length < MIN_VOICE_PHRASE_WORDS) return { kind: "tooShort" };

  // The escape word turns the rest of a line into text, and Spoken
  // Punctuation phrases are never Commands, switched off or not.
  for (const entry of entriesFor(language)) {
    const phrases = [...entry.phrases, ...(settings.aliases[entry.id] ?? [])].map(normalizePhrase);
    const literal = entry.actions.some((action) => action.kind === "literal");
    if (literal) {
      const word = phrases.find(
        (candidateWord) =>
          candidateWord !== "" &&
          (normalized === candidateWord || normalized.startsWith(`${candidateWord} `))
      );
      if (word) return { kind: "escape", entryId: entry.id, word };
    }
    if (phrases.includes(normalized)) return { kind: "duplicate", entryId: entry.id };
  }

  const { id, replacing } = candidate;
  const own = voicePhrases(id, language, voice).filter(
    (existing) =>
      replacing === undefined || normalizePhrase(existing) !== normalizePhrase(replacing)
  );
  const current = buildVoiceCommandTable(language, {
    ...voice,
    [id]: { ...voice[id], [language]: own },
  });
  for (const run of voiceCommandMatches(current, words)) {
    if (run.id === id) return { kind: "voiceDuplicate", phrase };
    if (contextsOverlap(contextsOf(id), contextsOf(run.id))) {
      return { kind: "voiceCommand", commandId: run.id, phrase };
    }
  }

  // The other way round: a phrase that keeps a default's filler matching
  // ("poner negrita" also hears "poner en negrita") may cover another
  // Command's own phrase.
  const alone = buildVoiceCommandTable(
    language,
    Object.fromEntries(
      voiceEligibleCommands().map((other) => [other, { [language]: other === id ? [phrase] : [] }])
    )
  );
  for (const other of voiceEligibleCommands()) {
    if (other === id || !contextsOverlap(contextsOf(id), contextsOf(other))) continue;
    for (const existing of voicePhrases(other, language, voice)) {
      const matched = voiceCommandMatches(alone, phraseWords(existing)).next();
      if (!matched.done) return { kind: "voiceCommand", commandId: other, phrase: existing };
    }
  }
  return null;
}

function aliasConflict(
  options: PhraseConflictOptions & { candidate: { kind: "alias" } }
): PhraseConflict | null {
  const { language, phrase, candidate, voice } = options;
  const settings = options.spokenPunctuation ?? defaultSpokenPunctuationLanguageSettings();
  const refusal = findAliasRefusal({
    language,
    entryId: candidate.entryId,
    alias: phrase,
    settings,
  });
  if (refusal) return refusal;

  // A whole line that is a Voice Command runs it before any Spoken
  // Punctuation is read, so the alias could never act.
  const words = phraseWords(phrase);
  const table = buildVoiceCommandTable(language, voice);
  for (const run of voiceCommandMatches(table, words)) {
    return { kind: "voiceCommand", commandId: run.id, phrase: phrase.trim() };
  }

  // A new escape word would turn a Voice Command that starts with it into text.
  if (isLiteralEntryId(language, candidate.entryId)) {
    const normalized = normalizePhrase(phrase);
    for (const id of voiceEligibleCommands()) {
      const shadowed = voicePhrases(id, language, voice).find((existing) =>
        normalizePhrase(existing).startsWith(`${normalized} `)
      );
      if (shadowed) return { kind: "voiceCommand", commandId: id, phrase: shadowed };
    }
  }
  return null;
}

/** The reason a phrase cannot be added, or null when it means one thing. */
export function findPhraseConflict(options: PhraseConflictOptions): PhraseConflict | null {
  return options.candidate.kind === "voice"
    ? voiceConflict(options as PhraseConflictOptions & { candidate: { kind: "voice" } })
    : aliasConflict(options as PhraseConflictOptions & { candidate: { kind: "alias" } });
}
