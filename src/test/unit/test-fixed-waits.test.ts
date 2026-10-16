// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXED_WAIT_BASELINE } from "@/test/time-budget";

// A fixed wait (`await new Promise((r) => setTimeout(r, 0))`, usually named
// `tick` or `flush`) guesses how many event-loop turns the code under test
// needs. On an idle laptop the guess holds; on a busy CI runner a MessagePort
// delivery, a React commit outside act, or a real hash lands a few turns later,
// and the assertion after it fails at random. The CI flakes of October 2026
// were all assertions that ran before the work they checked had landed; none
// was a timeout (docs/research/flaky-tests-2026-10.md). Wait for what you assert
// instead: `findBy*`, `waitFor`, or `vi.waitFor` (all on the suite's 10 s
// limit, src/test/setup.ts), or a promise the code resolves when it is done.

const root = resolve(__dirname, "../../..");

/** A sleep built on setTimeout whose callback only resolves a promise. */
const FIXED_WAIT = /(?<!["'`])\bsetTimeout\(\s*(resolve|res|r|done)\s*[,)]/;

function sourceFiles(dir: string, keep: (name: string) => boolean): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === "dist") return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path, keep);
    return keep(entry.name) ? [path] : [];
  });
}

/** Every test file, plus the shared test support a test calls into. */
function scannedFiles(): string[] {
  const isTest = (name: string) => /\.test\.tsx?$/.test(name);
  const isSource = (name: string) => /\.tsx?$/.test(name);
  return [
    ...sourceFiles(join(root, "src/test"), isTest),
    ...sourceFiles(join(root, "src/test/support"), (name) => isSource(name) && !isTest(name)),
    ...sourceFiles(join(root, "plugins"), isTest),
    ...sourceFiles(join(root, "templates"), isTest),
  ];
}

function fixedWaitCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const path of scannedFiles()) {
    // This file holds the patterns it tests the expression on.
    if (path === __filename) continue;
    const found = readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => FIXED_WAIT.test(line)).length;
    if (found > 0) counts[relative(root, path).split("\\").join("/")] = found;
  }
  return counts;
}

describe("fixed waits", () => {
  // The baseline only shrinks: a file not in it may hold none, a listed file
  // no more than its count, and a file that drops below its count lowers it.
  it("adds no fixed wait to the suite, and the baseline tracks every removal", () => {
    const counts = fixedWaitCounts();
    const grown = Object.entries(counts)
      .filter(([file, count]) => count > (FIXED_WAIT_BASELINE[file] ?? 0))
      .map(([file, count]) => `${file}: ${count} (baseline ${FIXED_WAIT_BASELINE[file] ?? 0})`);
    expect(
      grown,
      "Wait for the condition you assert (findBy*, waitFor, vi.waitFor, or a promise the code resolves) instead of a fixed number of event-loop turns. See src/test/unit/test-fixed-waits.test.ts."
    ).toEqual([]);

    const shrunk = Object.entries(FIXED_WAIT_BASELINE)
      .filter(([file, count]) => (counts[file] ?? 0) < count)
      .map(([file, count]) => `${file}: ${counts[file] ?? 0} (baseline ${count})`);
    expect(
      shrunk,
      "Fixed waits were removed: lower these entries in FIXED_WAIT_BASELINE (src/test/time-budget.ts), or delete them at 0."
    ).toEqual([]);
  });

  it("recognizes each form of fixed wait", () => {
    for (const line of [
      "await new Promise((resolve) => setTimeout(resolve, 0));",
      "const tick = () => new Promise<void>((r) => setTimeout(r));",
      "  await new Promise((res) => setTimeout(res, 25));",
      "new Promise((done) => setTimeout(done, 5))",
    ]) {
      expect(FIXED_WAIT.test(line), line).toBe(true);
    }
    for (const line of [
      "setTimeout(() => controller.abort(), 10);",
      "await vi.waitFor(() => expect(frames).toHaveLength(1));",
      'expect(TIMEOUT_LITERAL.test("setTimeout(resolve, 100);")).toBe(false);',
      "setTimeout(resolveLater, 0);",
    ]) {
      expect(FIXED_WAIT.test(line), line).toBe(false);
    }
  });
});
