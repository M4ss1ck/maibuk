// Collects the context biasing spike's numbers (issue #274) into Markdown
// tables, so the research doc quotes files, never hand-copied figures.
//   pnpm exec tsx scripts/dictation-phrases/biasing-results.ts [label ...]
//
// Labels default to the spike's runs. Reads, from vendor/moonshine/conformance:
// phrases-summary.<label>[.vocabulary-clips].json (phrase lane),
// native-<model>.<label>.json (real-time lane), and set-context-timing.json.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MODEL_CATALOG } from "@/features/dictation/catalog";
import { median, type RunSummary } from "./summary";

const here = dirname(fileURLToPath(import.meta.url));
const dir = resolve(here, "../../vendor/moonshine/conformance");

export const SPIKE_LABELS = ["base", "a-keyterms", "a-keyterms-boost3", "b-chapter"];

export interface TraceNumbers {
  lineLatencyP50: number | null;
  lines: number;
  cpuPct: number | null;
  setContextMs: number | null;
}

interface TraceDoc {
  summary?: { cpuPctOfOneCore?: number | null };
  bias?: { setContextMs?: number | null };
  trace?: { finalLatencyMs?: number | null }[];
}

/** A real-time lane trace in the numbers the spike compares. */
export function traceNumbers(doc: TraceDoc): TraceNumbers {
  const latencies = (doc.trace ?? []).flatMap((line) =>
    typeof line.finalLatencyMs === "number" ? [line.finalLatencyMs] : []
  );
  return {
    lineLatencyP50: median(latencies),
    lines: doc.trace?.length ?? 0,
    cpuPct: doc.summary?.cpuPctOfOneCore ?? null,
    setContextMs: doc.bias?.setContextMs ?? null,
  };
}

const read = <T>(name: string): T | null => {
  const path = join(dir, name);
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : null;
};
const pct = (rate: number | null | undefined) =>
  rate === null || rate === undefined ? "—" : `${(rate * 100).toFixed(1)}%`;
const ms = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : `${Math.round(value * 10) / 10}`;

function main(labels: readonly string[]) {
  const out: string[] = [];
  for (const [title, vocabulary] of [
    ["Phrase lane, model alone", ""],
    ["Phrase lane, with the run's own Phrase Recording Vocabulary", ".vocabulary-clips"],
  ] as const) {
    out.push(`## ${title}`, "");
    out.push(
      "| Run | Model | Names | Hit rate | Prose triggers (misheard) | Line latency p50 ms | Clip ms p50 | Vocabulary |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |"
    );
    for (const label of labels) {
      const doc = read<{ runs: RunSummary[] }>(`phrases-summary.${label}${vocabulary}.json`);
      for (const run of doc?.runs ?? []) {
        out.push(
          `| ${label} | ${run.model} | ${pct(run.nameHitRate)} | ${pct(run.hitRate)} | ${run.proseTriggers} (${run.misheardProseTriggers}) | ${ms(run.lineLatencyP50)} | ${ms(run.clipMsP50)} | ${run.vocabularyEntries} |`
        );
      }
    }
    out.push("");
  }
  out.push("## Real-time lane, native", "");
  out.push(
    "| Run | Model | Lines | Line latency p50 ms | CPU % of one core | setContext ms |",
    "| --- | --- | --- | --- | --- | --- |"
  );
  for (const label of labels) {
    for (const spec of MODEL_CATALOG) {
      const doc = read<TraceDoc>(`native-${spec.id}.${label}.json`);
      if (!doc) continue;
      const n = traceNumbers(doc);
      out.push(
        `| ${label} | ${spec.id} | ${n.lines} | ${ms(n.lineLatencyP50)} | ${ms(n.cpuPct)} | ${ms(n.setContextMs)} |`
      );
    }
  }
  out.push("");
  const timing = read<{
    runs: { model: string; passage: string; words: number; medianMs: number; worstMs: number }[];
  }>("set-context-timing.json");
  if (timing) {
    out.push("## setContext timing, native", "");
    out.push(
      "| Model | Passage | Words | Median ms | Worst ms |",
      "| --- | --- | --- | --- | --- |"
    );
    for (const run of timing.runs) {
      const passage = run.passage.split("/").slice(-2).join("/");
      out.push(
        `| ${run.model} | ${passage} | ${run.words} | ${ms(run.medianMs)} | ${ms(run.worstMs)} |`
      );
    }
  }
  console.log(out.join("\n"));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const labels = process.argv.slice(2);
  main(labels.length ? labels : SPIKE_LABELS);
}
