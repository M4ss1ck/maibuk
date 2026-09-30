// Gate for ADR 0016: every Command answers to its label. A Command without
// verb phrases or explicit whole-line phrases derives its default from its
// label in that Dictation Language; each default must be two words or more,
// collide with nothing, and be owned by exactly one Command.
import { describe, expect, it } from "vitest";
import { labelPhrase, VOICE_LABEL_EXCLUSIONS } from "@/features/dictation/label-phrases";
import { phraseWords } from "@/features/dictation/normalize";
import { findPhraseConflict } from "@/features/dictation/phrase-conflicts";
import type { DictationLanguage } from "@/features/dictation/types";
import {
  MIN_VOICE_PHRASE_WORDS,
  VOICE_LANGUAGES,
  defaultWholeLinePhrases,
} from "@/features/dictation/voice-commands";
import { COMMANDS, COMMAND_IDS, type CommandDef, type CommandId } from "@/lib/shortcut-registry";

interface WholeLineEntry {
  id: CommandId;
  phrase: string;
}

function wholeLineEntries(language: DictationLanguage): WholeLineEntry[] {
  return COMMAND_IDS.flatMap((id) =>
    defaultWholeLinePhrases(id, language).map((phrase) => ({ id, phrase }))
  );
}

/** Normalized whole-line phrases claimed by more than one Command. */
function findSharedWholeLinePhrases(entries: readonly WholeLineEntry[]): string[] {
  const owners = new Map<string, string[]>();
  for (const { id, phrase } of entries) {
    const key = phraseWords(phrase).join(" ");
    owners.set(key, [...(owners.get(key) ?? []), id]);
  }
  return [...owners.entries()].filter(([, ids]) => new Set(ids).size > 1).map(([key]) => key);
}

describe.each(VOICE_LANGUAGES)("voice label phrases (%s)", (language) => {
  it("derives a long enough label phrase for every Command without its own", () => {
    for (const id of COMMAND_IDS) {
      const voice = (COMMANDS[id] as CommandDef).voice;
      if (voice?.verbs !== undefined) continue;
      if (voice?.phrases?.[language] !== undefined) continue;
      if (VOICE_LABEL_EXCLUSIONS[id] !== undefined) continue;
      const label = labelPhrase(id, language);
      expect(label, `${id}: no label to derive a phrase from`).not.toBeNull();
      expect(
        phraseWords(label ?? "").length,
        `${id}: label "${label}" is too short to say`
      ).toBeGreaterThanOrEqual(MIN_VOICE_PHRASE_WORDS);
    }
  });

  // Each check builds two full phrase tables for ~200 Commands: about 1 s
  // locally, but over 5 s on CI with coverage instrumentation.
  it("keeps every default whole-line phrase clear of every other phrase", {
    timeout: 30_000,
  }, () => {
    for (const { id, phrase } of wholeLineEntries(language)) {
      expect(
        findPhraseConflict({
          language,
          phrase,
          candidate: { kind: "voice", id, replacing: phrase },
          voice: {},
        }),
        `${id}: "${phrase}" collides`
      ).toBeNull();
    }
  });

  it("gives no normalized whole-line phrase to two different Commands", () => {
    expect(findSharedWholeLinePhrases(wholeLineEntries(language))).toEqual([]);
  });
});

describe("VOICE_LABEL_EXCLUSIONS", () => {
  it("lists only Commands with a reason that truly need it", () => {
    for (const [id, reason] of Object.entries(VOICE_LABEL_EXCLUSIONS) as [CommandId, string][]) {
      expect(reason.trim().length, `${id}: exclusion needs a reason`).toBeGreaterThan(0);
      expect((COMMANDS[id] as CommandDef).voice, `${id}: exclusion is unneeded`).toBeUndefined();
    }
  });
});

describe("voice label refusals", () => {
  it("derives no phrase from a one-word label", () => {
    expect(phraseWords("Save").length).toBeLessThan(MIN_VOICE_PHRASE_WORDS);
  });

  it("derives no phrase from an interpolating label", () => {
    expect(labelPhrase("editor.lookUp", "en")).toBeNull();
    expect(labelPhrase("editor.lookUp", "es")).toBeNull();
  });

  it("reports two identical labels from the duplicate check", () => {
    expect(
      findSharedWholeLinePhrases([
        { id: "notes.newNote", phrase: "New note" },
        { id: "ephemeral.createNote", phrase: "new NOTE!" },
      ])
    ).toEqual(["new note"]);
    expect(
      findSharedWholeLinePhrases([
        { id: "notes.newNote", phrase: "New note" },
        { id: "ephemeral.createNote", phrase: "Create note" },
      ])
    ).toEqual([]);
  });
});
