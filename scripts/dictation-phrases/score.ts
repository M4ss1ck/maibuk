// Scores the phrase transcripts the native lane wrote (issue #285).
//   pnpm exec tsx scripts/dictation-phrases/score.ts [--vocabulary <file.json>]
//
// Reads vendor/moonshine/conformance/phrases-<model>.json, runs every clip's
// finished lines through the production Dictation Command Interpreter, writes
// vendor/moonshine/conformance/phrases-report.md, and exits non-zero when a
// ship bar fails. --vocabulary takes a Dictation Vocabulary shaped like the
// setting ({ "en": [{ "heard", "written" }], "es": [...] }) and applies it to
// the names tier only: the baseline context biasing must beat (issue #274).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MODEL_CATALOG } from "@/features/dictation/catalog";
import type { DictationLanguage } from "@/features/dictation/types";
import { normalizeVocabularySettings } from "@/features/dictation/vocabulary";
import { scoreModel, type Clip } from "@/test/support/dictation-phrase-score";
import { parseClipFileName } from "./clips";
import { namesRate, renderReport, type ScoredModel } from "./report";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "../../vendor/moonshine/conformance");

interface Transcripts {
  model: string;
  language: DictationLanguage;
  clips: { file: string; finals: string[] }[];
}

const vocabularyFlag = process.argv.indexOf("--vocabulary");
const vocabularyPath = vocabularyFlag === -1 ? undefined : process.argv[vocabularyFlag + 1];
if (vocabularyFlag !== -1 && !vocabularyPath) {
  console.error("usage: score.ts [--vocabulary <file.json>]");
  process.exit(1);
}
const vocabulary = normalizeVocabularySettings(
  vocabularyPath ? JSON.parse(readFileSync(vocabularyPath, "utf8")) : {}
);
if (vocabularyPath) {
  console.log(`vocabulary: ${vocabulary.en.length} en, ${vocabulary.es.length} es entries`);
}

const scored: ScoredModel[] = [];
for (const spec of MODEL_CATALOG) {
  const path = join(outDir, `phrases-${spec.id}.json`);
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
  scored.push({
    spec,
    clipCount: clips.length,
    score: scoreModel({
      language: doc.language,
      capabilities: spec.capabilities,
      clips,
      vocabulary: vocabulary[doc.language],
    }),
  });
}

if (scored.length === 0) {
  console.error("no transcripts: record clips, then run the native phrase lane");
  process.exit(1);
}

const report = renderReport(scored);
const reportPath = join(outDir, "phrases-report.md");
writeFileSync(reportPath, report.markdown);
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
