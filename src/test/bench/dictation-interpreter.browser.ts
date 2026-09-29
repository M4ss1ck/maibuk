// The Dictation Interpreter bench for a browser engine: the same worst-case
// inputs as dictation-interpreter.bench.ts, run in Chrome on an Android device
// by scripts/dictation-bench/android.mjs (`pnpm bench:dictation:android`).
// Vitest bench runs only in Node, so this page samples each call itself and
// posts results in the shape of `vitest bench --outputJson`, which
// scripts/dictation-bench-budget.mjs checks against the ADR 0015 budget.
import {
  INITIAL_INTERPRETER_STATE,
  buildPhraseTable,
  interpret,
} from "@/features/dictation/interpreter";
import type { DictationLanguage } from "@/features/dictation/types";
import { interpreterBenchCase } from "@/test/support/dictation-bench";

interface Sampled {
  name: string;
  mean: number;
  p99: number;
  sampleCount: number;
}

function sample(name: string, fn: () => void, minSamples: number, minTimeMs: number): Sampled {
  for (let i = 0; i < Math.min(minSamples, 50); i += 1) fn();
  const samples: number[] = [];
  const start = performance.now();
  while (samples.length < minSamples || performance.now() - start < minTimeMs) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const p99 = samples[Math.ceil(samples.length * 0.99) - 1];
  return { name, mean, p99, sampleCount: samples.length };
}

function run() {
  const languages: DictationLanguage[] = ["en", "es"];
  const groups = languages.map((language) => {
    const benchCase = interpreterBenchCase(language);
    const table = buildPhraseTable(language, benchCase.options);
    return {
      fullName: `dictation-interpreter.browser.ts > dictation interpreter (${language})`,
      benchmarks: [
        sample(
          "interpret: worst-case line",
          () => {
            interpret({
              line: benchCase.line,
              before: benchCase.before,
              capabilities: benchCase.capabilities,
              table,
              state: INITIAL_INTERPRETER_STATE,
            });
          },
          5_000,
          2_000
        ),
        sample(
          "rebuild: phrase table",
          () => buildPhraseTable(language, benchCase.options),
          300,
          2_000
        ),
      ],
    };
  });
  return {
    environment: {
      userAgent: navigator.userAgent,
      crossOriginIsolated: globalThis.crossOriginIsolated === true,
    },
    files: [{ filepath: "dictation-interpreter.browser.ts", groups }],
  };
}

// Let the page paint before the busy loop starts.
setTimeout(() => {
  const status = document.getElementById("status");
  try {
    const report = run();
    if (status) status.textContent = JSON.stringify(report, null, 2);
    void fetch("/result", { method: "POST", body: JSON.stringify(report) });
  } catch (error) {
    if (status) status.textContent = String(error);
    void fetch("/result", { method: "POST", body: JSON.stringify({ error: String(error) }) });
  }
}, 500);
