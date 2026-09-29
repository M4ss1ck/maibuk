// Scores the phrase transcripts the native lane wrote (issue #285).
//   pnpm exec tsx scripts/dictation-phrases/score.ts
//
// Reads vendor/moonshine/conformance/phrases-<model>.json, runs every clip's
// finished lines through the production Dictation Command Interpreter, writes
// vendor/moonshine/conformance/phrases-report.md, and exits non-zero when a
// ship bar fails.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MODEL_CATALOG } from "@/features/dictation/catalog";
import type { DictationLanguage } from "@/features/dictation/types";
import { scoreModel, type Clip } from "@/test/support/dictation-phrase-score";
import { parseClipFileName } from "./clips";
import { renderReport, type ScoredModel } from "./report";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "../../vendor/moonshine/conformance");

interface Transcripts {
  model: string;
  language: DictationLanguage;
  clips: { file: string; finals: string[] }[];
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
    score: scoreModel({ language: doc.language, capabilities: spec.capabilities, clips }),
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
    `${spec.id.padEnd(28)} ${spec.tier.padEnd(9)} hit ${Math.round(score.hitRate * 100)}%  prose triggers ${score.proseTriggers}`
  );
}
console.log(`report: ${reportPath}`);
if (report.failures.length) {
  console.log("\nFailed bars:");
  for (const failure of report.failures) console.log(`  ${failure}`);
  process.exit(1);
}
