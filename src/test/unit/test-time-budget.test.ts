// @vitest-environment node
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { getConfig } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { TestModule } from "vitest/node";
import TimeBudgetReporter from "@/test/support/time-budget-reporter";
import {
  githubAnnotations,
  summaryMarkdown,
  type TimedTest,
  testsOverBudget,
} from "@/test/support/time-budget-report";
import {
  ASYNC_UTIL_TIMEOUT_MS,
  allowedTimeouts,
  TEST_TIMEOUT_MS,
  TIMEOUT_EXCEPTIONS,
} from "@/test/time-budget";

const root = resolve(__dirname, "../../..");

function testFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return testFiles(path);
    return /\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

// A timeout literal: an options object (`{ timeout: 10_000 }`, for a test,
// a suite, or a wait) or a test's trailing argument (`}, 20_000);`).
const TIMEOUT_LITERAL = /\btimeout:\s*[\d_]+|\},\s*[\d_]{4,}\)/;
const MARKER = "time-budget:";

describe("test time budget", () => {
  it("runs every test on the suite's one timeout", ({ task }) => {
    expect(task.timeout).toBe(TEST_TIMEOUT_MS);
  });

  it("gives waitFor and findBy the suite's wait limit", () => {
    expect(getConfig().asyncUtilTimeout).toBe(ASYNC_UTIL_TIMEOUT_MS);
  });

  // The setup file's guard fails a test with its own timeout before it runs,
  // so this test can only fail through the guard. `fails` turns that into a pass.
  it.fails("refuses a test that sets its own timeout", { timeout: 20_000 }, () => {});

  it("allows a longer timeout only to a listed file that exists", () => {
    for (const [file, { timeoutMs, reason }] of Object.entries(TIMEOUT_EXCEPTIONS)) {
      expect(existsSync(join(root, file)), file).toBe(true);
      expect(timeoutMs, file).toBeGreaterThan(TEST_TIMEOUT_MS);
      expect(reason.length, file).toBeGreaterThan(20);
      expect(allowedTimeouts(file)).toEqual([TEST_TIMEOUT_MS, timeoutMs]);
    }
    expect(allowedTimeouts("src/test/unit/anything.test.ts")).toEqual([TEST_TIMEOUT_MS]);
  });

  // The setup file reads the file through `relative(cwd, filepath)`, which on
  // Windows spells the separators as backslashes while every key is written
  // with forward slashes, so a listed file would silently lose its raise.
  it("finds a listed file through Windows separators, and still defaults", () => {
    for (const [file, { timeoutMs }] of Object.entries(TIMEOUT_EXCEPTIONS)) {
      expect(allowedTimeouts(file.split("/").join("\\")), file).toEqual([
        TEST_TIMEOUT_MS,
        timeoutMs,
      ]);
    }
    expect(allowedTimeouts("src\\test\\unit\\anything.test.ts")).toEqual([TEST_TIMEOUT_MS]);
  });

  // Per-file raises are how the suite ended up at the edge of every limit:
  // each one fixed the test that was red that day and hid the next one.
  it("keeps timeout literals out of tests unless a comment says why", () => {
    const unexplained: string[] = [];
    for (const path of testFiles(join(root, "src/test"))) {
      // This file holds the literals it tests the pattern on.
      if (path === __filename) continue;
      const lines = readFileSync(path, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (!TIMEOUT_LITERAL.test(line)) return;
        if (line.includes(MARKER) || lines[i - 1]?.includes(MARKER)) return;
        unexplained.push(`${relative(root, path)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(
      unexplained,
      `Remove these overrides, or put a "// ${MARKER} <why>" comment on the line above. The suite's budget lives in src/test/time-budget.ts.`
    ).toEqual([]);
  });

  it("catches each form of timeout literal", () => {
    for (const line of [
      'describe("x", { timeout: 30_000 }, () => {',
      "  }, 20_000);",
      "await waitFor(() => expect(a).toBe(b), { timeout: 2000 });",
      "    timeout: 10_000,",
    ]) {
      expect(TIMEOUT_LITERAL.test(line), line).toBe(true);
    }
    for (const line of [
      "await waitFor(() => expect(a).toBe(b));",
      "setTimeout(resolve, 100);",
      "}, 300);",
    ]) {
      expect(TIMEOUT_LITERAL.test(line), line).toBe(false);
    }
  });
});

describe("time budget report", () => {
  const timed = (name: string, durationMs: number, timeoutMs = 60_000): TimedTest => ({
    file: "src/test/integration/a.test.tsx",
    name,
    durationMs,
    timeoutMs,
  });

  it("lists only tests past half their timeout, worst share first", () => {
    const over = testsOverBudget([
      timed("fast", 1_000),
      timed("at half", 30_000),
      timed("tight", 45_000),
      timed("tighter", 30_000, 40_000),
      timed("worst", 59_000),
    ]);
    expect(over.map((t) => t.name)).toEqual(["worst", "tight", "tighter"]);
  });

  it("annotates each test for GitHub, escaping what workflow commands reserve", () => {
    const [line] = githubAnnotations([
      {
        file: "src/test/a,b.test.ts",
        name: "50% done: a\nb",
        durationMs: 45_000,
        timeoutMs: 60_000,
      },
    ]);
    expect(line).toBe(
      "::warning file=src/test/a%2Cb.test.ts,title=Test near its timeout::50%25 done: a%0Ab took 45.0 s, 75%25 of its 60.0 s timeout. Make it cheaper before it times out."
    );
  });

  it("writes a summary table, and says so when every test has room", () => {
    const table = summaryMarkdown([timed("slow | one", 45_000)]);
    expect(table).toContain("1 test(s) used more than 50% of their timeout");
    expect(table).toContain(
      "| 75% | 45.0 s | 60.0 s | `src/test/integration/a.test.tsx` | slow \\| one |"
    );
    expect(summaryMarkdown([])).toContain("Every test finished within 50% of its timeout.");
  });
});

describe("TimeBudgetReporter", () => {
  // The shape Vitest hands onTestRunEnd, cut down to what the reporter reads.
  function moduleWith(tests: { name: string; duration?: number; timeout: number }[]) {
    return {
      moduleId: "/repo/src/test/integration/slow.test.tsx",
      children: {
        *allTests() {
          for (const t of tests) {
            yield {
              fullName: t.name,
              task: { timeout: t.timeout },
              diagnostic: () => (t.duration === undefined ? undefined : { duration: t.duration }),
            };
          }
        },
      },
    } as unknown as TestModule;
  }
  const run = moduleWith([
    { name: "slow", duration: 40_000, timeout: 60_000 },
    { name: "fast", duration: 100, timeout: 60_000 },
    { name: "skipped", timeout: 60_000 },
  ]);

  it("annotates tight tests, and prints and writes the job summary on GitHub Actions", () => {
    const summaryFile = join(mkdtempSync(join(tmpdir(), "budget-")), "summary.md");
    const lines: string[] = [];
    new TimeBudgetReporter({
      env: { GITHUB_ACTIONS: "true", GITHUB_STEP_SUMMARY: summaryFile },
      cwd: "/repo",
      log: (line) => lines.push(line),
    }).onTestRunEnd([run]);

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(
      /^::warning file=src\/test\/integration\/slow\.test\.tsx,.*::slow took 40\.0 s/
    );
    const summary = readFileSync(summaryFile, "utf8");
    expect(summary).toContain("| 67% | 40.0 s | 60.0 s |");
    // The step log carries the summary verbatim: the job summary is not
    // readable back through the GitHub API.
    expect(lines[1]).toBe(summary);
  });

  it("still prints and writes the summary on GitHub Actions when every test has room", () => {
    const summaryFile = join(mkdtempSync(join(tmpdir(), "budget-")), "summary.md");
    const lines: string[] = [];
    new TimeBudgetReporter({
      env: { GITHUB_ACTIONS: "true", GITHUB_STEP_SUMMARY: summaryFile },
      cwd: "/repo",
      log: (line) => lines.push(line),
    }).onTestRunEnd([moduleWith([{ name: "fast", duration: 100, timeout: 60_000 }])]);

    expect(lines).toHaveLength(1);
    const summary = readFileSync(summaryFile, "utf8");
    expect(summary).toContain("Every test finished within 50%");
    expect(lines[0]).toBe(summary);
  });

  it("prints the table locally only when a test is tight, and never fails the run", () => {
    const lines: string[] = [];
    const reporter = new TimeBudgetReporter({ env: {}, cwd: "/repo", log: (l) => lines.push(l) });
    expect(() => reporter.onTestRunEnd([run])).not.toThrow();
    expect(lines.join("\n")).toContain("`src/test/integration/slow.test.tsx` | slow |");

    lines.length = 0;
    reporter.onTestRunEnd([moduleWith([{ name: "fast", duration: 100, timeout: 60_000 }])]);
    expect(lines).toEqual([]);
  });
});
