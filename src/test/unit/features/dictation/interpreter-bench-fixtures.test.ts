// Gate-lane check on the Dictation Interpreter bench fixtures (issue #284):
// the fixtures must keep exercising every path the periodic bench measures.
// Timing is measured only in the periodic lane, so nothing here asserts time.
import { describe, expect, it } from "vitest";
import {
  INITIAL_INTERPRETER_STATE,
  buildPhraseTable,
  interpret,
} from "@/features/dictation/interpreter";
import { normalizePhrase, tokenize, tokenWords } from "@/features/dictation/normalize";
import { VOICE_VOCABULARY, defaultWholeLinePhrases } from "@/features/dictation/voice-commands";
import {
  BENCH_ALIAS_COUNT,
  BENCH_VOCABULARY_COUNT,
  interpreterBenchCase,
} from "@/test/support/dictation-bench";

/** The prose prefix the synthetic aliases start with, and the fixture claims to walk. */
const PROSE_PREFIX: Record<"en" | "es", readonly [string, string, string]> = {
  en: ["the", "quiet", "river"],
  es: ["el", "viejo", "molino"],
};

function textOf(result: ReturnType<typeof interpret>): string {
  if (result.result.kind !== "edits") {
    throw new Error(`expected edits, got ${result.result.kind}`);
  }
  return result.result.edits
    .filter((edit) => edit.kind === "text")
    .map((edit) => (edit.kind === "text" ? edit.text : ""))
    .join(" ");
}

describe.each(["en", "es"] as const)("interpreter bench fixtures (%s)", (language) => {
  const benchCase = interpreterBenchCase(language);
  const table = buildPhraseTable(language, benchCase.options);
  const interpretation = interpret({
    line: benchCase.line,
    before: benchCase.before,
    capabilities: benchCase.capabilities,
    table,
    state: INITIAL_INTERPRETER_STATE,
  });

  it("keeps the line at the worst-case length", () => {
    const wordCount = tokenWords(tokenize(benchCase.line)).length;
    expect(wordCount).toBeGreaterThanOrEqual(55);
    expect(wordCount).toBeLessThanOrEqual(65);
  });

  it("ends with the demonstrative, so the whole-line match tries that path too", () => {
    const words = benchCase.line.split(/\s+/).filter(Boolean);
    const lastWord = words[words.length - 1];
    expect(VOICE_VOCABULARY[language].demonstratives).toContain(lastWord);
  });

  it("carries the full alias and vocabulary load", () => {
    const aliasCount = Object.values(benchCase.options.settings?.aliases ?? {}).reduce(
      (total, phrases) => total + phrases.length,
      0
    );
    expect(aliasCount).toBe(BENCH_ALIAS_COUNT);
    expect(benchCase.options.vocabulary).toHaveLength(BENCH_VOCABULARY_COUNT);
  });

  it("sits at the bounded-text limit", () => {
    expect(benchCase.before).toHaveLength(256);
  });

  it("keeps every alias and heard form unique after normalization", () => {
    const aliases = Object.values(benchCase.options.settings?.aliases ?? {}).flat();
    const keptAliases = aliases.map(normalizePhrase);
    expect(new Set(keptAliases).size).toBe(keptAliases.length);

    const heard = (benchCase.options.vocabulary ?? []).map((entry) => normalizePhrase(entry.heard));
    expect(new Set(heard).size).toBe(heard.length);
  });

  it("produces edits that hit every layout kind", () => {
    expect(interpretation.result.kind).toBe("edits");
    if (interpretation.result.kind !== "edits") return;
    const kinds = interpretation.result.edits.map((edit) => edit.kind);
    expect(kinds).toContain("paragraph");
    expect(kinds).toContain("line_break");
    expect(interpretation.spokenPunctuationCount).toBeGreaterThanOrEqual(8);
  });

  it("hits the real Vocabulary entries but never the synthetic ones", () => {
    const text = textOf(interpretation);
    expect(text).toContain("Moonshine");
    expect(text).toContain("TipTap");
    expect(text).not.toContain("Written");
  });

  it("writes the numeral run as digits", () => {
    const text = textOf(interpretation);
    const expected: Record<"en" | "es", string> = { en: "999001", es: "999999" };
    expect(text).toContain(expected[language]);
  });

  it("never matches a synthetic alias or heard form, only deepens the tries", () => {
    const { vocabulary = [], settings } = benchCase.options;
    const withoutSynthetic = interpret({
      line: benchCase.line,
      before: benchCase.before,
      capabilities: benchCase.capabilities,
      table: buildPhraseTable(language, {
        ...benchCase.options,
        settings: settings && { ...settings, aliases: {} },
        vocabulary: vocabulary.filter((entry) => !entry.written.startsWith("Written")),
      }),
      state: INITIAL_INTERPRETER_STATE,
    });
    expect(withoutSynthetic).toEqual(interpretation);
  });

  it("walks a deep trie along the prose the synthetic aliases start with", () => {
    const [first, second, third] = PROSE_PREFIX[language];
    const firstNode = table.trie.children.get(normalizePhrase(first));
    expect(firstNode).toBeDefined();
    const secondNode = firstNode?.children.get(normalizePhrase(second));
    expect(secondNode).toBeDefined();
    const thirdNode = secondNode?.children.get(normalizePhrase(third));
    expect(thirdNode).toBeDefined();
    expect(thirdNode?.children.size).toBeGreaterThan(0);
  });

  it("carries a label-derived whole-line phrase in the exact map (ADR 0016)", () => {
    const derived = defaultWholeLinePhrases("global.gotoNotes", language);
    expect(derived.length).toBeGreaterThan(0);
    for (const phrase of derived) {
      expect(table.voice.exact.has(normalizePhrase(phrase)), phrase).toBe(true);
    }
  });
});
