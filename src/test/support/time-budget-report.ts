import { TIME_BUDGET_HEADROOM } from "@/test/time-budget";

export interface TimedTest {
  /** Repo-relative test file. */
  file: string;
  name: string;
  durationMs: number;
  timeoutMs: number;
}

/** Tests that used more than `headroom` of their timeout, worst share first. */
export function testsOverBudget(
  tests: readonly TimedTest[],
  headroom = TIME_BUDGET_HEADROOM
): TimedTest[] {
  return tests
    .filter((t) => t.timeoutMs > 0 && t.durationMs > t.timeoutMs * headroom)
    .sort((a, b) => b.durationMs / b.timeoutMs - a.durationMs / a.timeoutMs);
}

function share(t: TimedTest): string {
  return `${Math.round((t.durationMs / t.timeoutMs) * 100)}%`;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

/** One `::warning` workflow command per test, so GitHub annotates the run. */
export function githubAnnotations(over: readonly TimedTest[]): string[] {
  // Workflow command values escape %, CR and LF; properties also escape : and ,.
  const data = (s: string) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  const prop = (s: string) => data(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
  return over.map(
    (t) =>
      `::warning file=${prop(t.file)},title=${prop("Test near its timeout")}::${data(
        `${t.name} took ${seconds(t.durationMs)}, ${share(t)} of its ${seconds(t.timeoutMs)} timeout. Make it cheaper before it times out.`
      )}`
  );
}

/** The Markdown table for the job summary. */
export function summaryMarkdown(
  over: readonly TimedTest[],
  headroom = TIME_BUDGET_HEADROOM
): string {
  const pct = Math.round(headroom * 100);
  if (over.length === 0) {
    return `### Test time budget\n\nEvery test finished within ${pct}% of its timeout.\n`;
  }
  const cell = (s: string) => s.replace(/\|/g, "\\|");
  const rows = over.map(
    (t) =>
      `| ${share(t)} | ${seconds(t.durationMs)} | ${seconds(t.timeoutMs)} | \`${cell(t.file)}\` | ${cell(t.name)} |`
  );
  return [
    "### Test time budget",
    "",
    `${over.length} test(s) used more than ${pct}% of their timeout. CI runners vary up to 2x, so these are the next timeouts: make them cheaper (src/test/time-budget.ts explains the budget).`,
    "",
    "| Used | Took | Timeout | File | Test |",
    "| ---: | ---: | ---: | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}
