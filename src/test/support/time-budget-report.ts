import { TIME_BUDGET_HEADROOM } from "@/test/time-budget";

export interface TimedTest {
  /** Repo-relative test file. */
  file: string;
  name: string;
  durationMs: number;
  timeoutMs: number;
}

/** Wall time a file's tests may add up to before it is worth splitting. */
export const FILE_BUDGET_MS = 30_000;

/** Tests that used more than `headroom` of their timeout, worst share first. */
export function testsOverBudget(
  tests: readonly TimedTest[],
  headroom = TIME_BUDGET_HEADROOM
): TimedTest[] {
  return tests
    .filter((t) => t.timeoutMs > 0 && t.durationMs > t.timeoutMs * headroom)
    .sort((a, b) => b.durationMs / b.timeoutMs - a.durationMs / a.timeoutMs);
}

export interface FileOverBudget {
  /** Repo-relative test file. */
  file: string;
  /** Sum of every test's duration in the file. */
  durationMs: number;
  /** How many tests contributed to `durationMs`. */
  tests: number;
}

/** Files whose tests add up to more than `budgetMs`, worst sum first. */
export function filesOverBudget(
  tests: readonly TimedTest[],
  budgetMs = FILE_BUDGET_MS
): FileOverBudget[] {
  const totals = new Map<string, FileOverBudget>();
  for (const t of tests) {
    const entry = totals.get(t.file) ?? { file: t.file, durationMs: 0, tests: 0 };
    entry.durationMs += t.durationMs;
    entry.tests += 1;
    totals.set(t.file, entry);
  }
  return [...totals.values()]
    .filter((f) => f.durationMs > budgetMs)
    .sort((a, b) => b.durationMs - a.durationMs);
}

function share(t: TimedTest): string {
  return `${Math.round((t.durationMs / t.timeoutMs) * 100)}%`;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

/** One `::warning` workflow command per test, so GitHub annotates the run. */
export function githubAnnotations(
  over: readonly TimedTest[],
  files: readonly FileOverBudget[] = []
): string[] {
  // Workflow command values escape %, CR and LF; properties also escape : and ,.
  const data = (s: string) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  const prop = (s: string) => data(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
  return [
    ...over.map(
      (t) =>
        `::warning file=${prop(t.file)},title=${prop("Test near its timeout")}::${data(
          `${t.name} took ${seconds(t.durationMs)}, ${share(t)} of its ${seconds(t.timeoutMs)} timeout. Make it cheaper before it times out.`
        )}`
    ),
    ...files.map(
      (f) =>
        `::warning file=${prop(f.file)},title=${prop("File over its time budget")}::${data(
          `${f.file} took ${seconds(f.durationMs)} of test time across ${f.tests} tests, over the ${seconds(FILE_BUDGET_MS)} file budget. Split it.`
        )}`
    ),
  ];
}

/** The Markdown table for the job summary. */
export function summaryMarkdown(
  over: readonly TimedTest[],
  files: readonly FileOverBudget[] = [],
  headroom = TIME_BUDGET_HEADROOM
): string {
  const pct = Math.round(headroom * 100);
  if (over.length === 0 && files.length === 0) {
    return `### Test time budget\n\nEvery test finished within ${pct}% of its timeout.\nEvery file is under the ${FILE_BUDGET_MS / 1000} s budget.\n`;
  }
  const cell = (s: string) => s.replace(/\|/g, "\\|");
  const lines = ["### Test time budget", ""];
  if (over.length > 0) {
    const rows = over.map(
      (t) =>
        `| ${share(t)} | ${seconds(t.durationMs)} | ${seconds(t.timeoutMs)} | \`${cell(t.file)}\` | ${cell(t.name)} |`
    );
    lines.push(
      `${over.length} test(s) used more than ${pct}% of their timeout. CI runners vary up to 2x, so these are the next timeouts: make them cheaper (src/test/time-budget.ts explains the budget).`,
      "",
      "| Used | Took | Timeout | File | Test |",
      "| ---: | ---: | ---: | --- | --- |",
      ...rows,
      ""
    );
  }
  if (files.length > 0) {
    const rows = files.map(
      (f) => `| ${seconds(f.durationMs)} | ${f.tests} | \`${cell(f.file)}\` |`
    );
    lines.push(
      `${files.length} file(s) summed to more than ${FILE_BUDGET_MS / 1000} s of test time. Vitest shards by whole file, so one slow file sets the slowest shard: split it.`,
      "",
      "| Took | Tests | File |",
      "| ---: | ---: | --- |",
      ...rows,
      ""
    );
  }
  return lines.join("\n");
}
