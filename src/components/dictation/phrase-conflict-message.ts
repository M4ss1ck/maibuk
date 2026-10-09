import type { TFunction } from "i18next";
import type { PhraseConflict } from "@/features/dictation/phrase-conflicts";
import { entriesFor } from "@/features/dictation/spoken-punctuation";
import type { DictationLanguage } from "@/features/dictation/types";
import { commandLabel, type CommandId } from "@/lib/shortcut-registry";

/**
 * The message for a refused phrase, in the Shortcut Conflict style: what the
 * phrase already means. Shared by the Shortcut Editor's Voice Commands and
 * Settings → Dictation's Spoken Punctuation aliases.
 */
export function phraseConflictMessage(
  t: TFunction,
  language: DictationLanguage,
  conflict: PhraseConflict,
  phrase: string,
  /** The Command the phrase was for; names it when the Command already has it. */
  ownCommand?: CommandId
): string {
  const entry = (entryId: string) =>
    entriesFor(language).find((candidate) => candidate.id === entryId)?.phrases[0] ?? entryId;
  // Command labels are registry data, so their keys are plain strings.
  const command = (id: CommandId) => commandLabel(id, t);
  switch (conflict.kind) {
    case "empty":
      return t("dictation.spokenPunctuation.refused.empty");
    case "tooShort":
      return t("dictation.phraseRefused.tooShort");
    case "duplicate":
      return ownCommand
        ? t("dictation.phraseRefused.spokenPunctuation", { phrase, entry: entry(conflict.entryId) })
        : t("dictation.spokenPunctuation.refused.duplicate", {
            phrase,
            entry: entry(conflict.entryId),
          });
    case "escape":
      return t("dictation.spokenPunctuation.refused.escape", { phrase, word: conflict.word });
    case "shadow":
      return t("dictation.spokenPunctuation.refused.shadow", {
        phrase,
        conflict: conflict.conflict,
        entry: entry(conflict.entryId),
      });
    case "voiceDuplicate":
      return t("dictation.phraseRefused.voiceCommand", {
        phrase,
        command: ownCommand ? command(ownCommand) : "",
      });
    case "voiceCommand":
      return t("dictation.phraseRefused.voiceCommand", {
        phrase: conflict.phrase,
        command: command(conflict.commandId),
      });
    case "clickWord":
      return t("dictation.phraseRefused.clickWord", { word: conflict.word });
  }
}
