import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import packageJson from "../../../package.json";

const workflow = readFileSync(resolve(__dirname, "../../../.github/workflows/ci.yml"), "utf8");

/** The text of one top-level job, from its key to the next job's key. */
function job(name: string): string {
  const match = workflow.match(
    new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  [a-z][\\w-]*:\\n|$)`)
  );
  if (!match) throw new Error(`ci.yml has no "${name}" job`);
  return match[1];
}

describe("CI workflow", () => {
  // A type error in a test file once reached main: Vitest strips types without
  // checking them, and tsc only ran inside the last step of a 10-minute job.
  it("typechecks in the fast job, apart from the test shards", () => {
    expect(packageJson.scripts.typecheck).toBe("tsc");
    const checks = job("checks");
    expect(checks).toContain("run: pnpm typecheck");
    expect(checks).toContain("run: pnpm lint");
    expect(checks).not.toContain("vitest");
    expect(checks).not.toMatch(/needs:/);
  });

  it("shards the suite and enforces the coverage thresholds only on the merged report", () => {
    const tests = job("tests");
    expect(tests).toContain("--shard=${{ matrix.shard }}/");
    expect(tests).toContain("--reporter=blob");
    for (const metric of ["lines", "functions", "statements", "branches"]) {
      expect(tests).toContain(`--coverage.thresholds.${metric}=0`);
    }

    const coverage = job("coverage");
    expect(coverage).toContain("needs: tests");
    expect(coverage).toContain("vitest run --mergeReports --coverage");
    expect(coverage).not.toContain("--coverage.thresholds");
  });

  // The merge runs the time budget reporter from vite.config.ts (no --reporter
  // flag, which would replace it), and must run after a failed shard too.
  it("reports the time budget from the merged run, even when a shard failed", () => {
    const coverage = job("coverage");
    expect(coverage).toContain(["if: $", "{{ !cancelled() }}"].join(""));
    expect(coverage).not.toContain("--reporter");
    expect(readFileSync(resolve(__dirname, "../../../vite.config.ts"), "utf8")).toContain(
      "./src/test/support/time-budget-reporter.ts"
    );
  });
});
