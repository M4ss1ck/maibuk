// Scores the phrase transcripts the native lane wrote (issue #285).
//   pnpm exec tsx scripts/dictation-phrases/score.ts [--label <label>]
//     [--vocabulary <file.json> | --vocabulary-from-clips]
//
// Reads vendor/moonshine/conformance/phrases-<model>.json, runs every clip's
// finished lines through the production Dictation Command Interpreter, writes
// vendor/moonshine/conformance/phrases-report.md, and exits non-zero when a
// ship bar fails. --vocabulary takes a Dictation Vocabulary shaped like the
// setting ({ "en": [{ "heard", "written" }], "es": [...] }) and applies it to
// the names tier only: the baseline context biasing must beat (issue #274).
// --vocabulary-from-clips builds that Vocabulary from the run's own names said
// alone, one Phrase Recording each. --label reads a biased run's transcripts
// (phrases-<model>.<label>.json) and writes phrases-report.<label>.md. Every run
// also writes phrases-summary[.<label>].json: the numbers the spike compares.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MODEL_CATALOG } from "@/features/dictation/catalog";
import type { DictationLanguage } from "@/features/dictation/types";
import { normalizeVocabularySettings, type VocabularyEntry } from "@/features/dictation/vocabulary";
import {
  phraseRecordingVocabulary,
  scoreModel,
  type Clip,
} from "@/test/support/dictation-phrase-score";
import { parseClipFileName } from "./clips";
import { namesRate, renderReport, type ScoredModel } from "./report";
import { runSummary, type RunClip, type RunSummary } from "./summary";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "../../vendor/moonshine/conformance");

interface Transcripts {
  model: string;
  language: DictationLanguage;
  setContextMs?: number | null;
  clips: ({ file: string; finals: string[] } & RunClip)[];
}

const USAGE =
  "usage: score.ts [--label <label>] [--vocabulary <file.json> | --vocabulary-from-clips]";
const option = (name: string) => {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    console.error(USAGE);
    process.exit(1);
  }
  return value;
};
const label = option("--label");
const vocabularyPath = option("--vocabulary");
const fromClips = process.argv.includes("--vocabulary-from-clips");
if (vocabularyPath && fromClips) {
  console.error(USAGE);
  process.exit(1);
}
const suffix = label ? `.${label}` : "";
const vocabulary = normalizeVocabularySettings(
  vocabularyPath ? JSON.parse(readFileSync(vocabularyPath, "utf8")) : {}
);
if (vocabularyPath) {
  console.log(`vocabulary: ${vocabulary.en.length} en, ${vocabulary.es.length} es entries`);
}

const scored: ScoredModel[] = [];
const summaries: RunSummary[] = [];
const recorded: Record<string, VocabularyEntry[]> = {};
for (const spec of MODEL_CATALOG) {
  const path = join(outDir, `phrases-${spec.id}${suffix}.json`);
  if (!existsSync(path)) {
    console.log(`${spec.id}: no transcripts (${path})`);
    continue;
  }
  const doc = JSON.parse(readFileSync(path, "utf8")) as Transcripts;
  const clips: Clip[] = [];
  for (const clip of doc.clips) {
    const parsed = parseClipFileName(clip.file);
    if (parsed) clips.push({ itemId: parsed.id, finals: clip.finals });
  }
  const own = fromClips ? phraseRecordingVocabulary(doc.language, clips) : vocabulary[doc.language];
  if (fromClips) recorded[spec.id] = own;
  const score = scoreModel({
    language: doc.language,
    capabilities: spec.capabilities,
    clips,
    vocabulary: own,
  });
  scored.push({ spec, clipCount: clips.length, score });
  summaries.push(
    runSummary({
      model: spec.id,
      score,
      clips: doc.clips,
      setContextMs: doc.setContextMs,
      vocabularyEntries: own.length,
    })
  );
}

if (scored.length === 0) {
  console.error("no transcripts: record clips, then run the native phrase lane");
  process.exit(1);
}

const report = renderReport(scored);
const vocabularySuffix = fromClips ? ".vocabulary-clips" : vocabularyPath ? ".vocabulary-file" : "";
const reportPath = join(outDir, `phrases-report${suffix}${vocabularySuffix}.md`);
writeFileSync(reportPath, report.markdown);
writeFileSync(
  join(outDir, `phrases-summary${suffix}${vocabularySuffix}.json`),
  `${JSON.stringify({ label: label ?? null, vocabulary: vocabularySuffix.slice(12) || "none", recorded, runs: summaries }, null, 2)}\n`
);
for (const { spec, score } of scored) {
  console.log(
    `${spec.id.padEnd(28)} ${spec.tier.padEnd(9)} hit ${Math.round(score.hitRate * 100)}%  prose triggers ${score.proseTriggers}  names ${namesRate(score.nameHitRate)}`
  );
}
console.log(`report: ${reportPath}`);
if (report.failures.length) {
  console.log("\nFailed bars:");
  for (const failure of report.failures) console.log(`  ${failure}`);
  process.exit(1);
}
