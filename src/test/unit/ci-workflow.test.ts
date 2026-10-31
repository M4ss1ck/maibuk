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

  // The e2e project has its own tsconfig, outside the root one: without this
  // step a broken e2e config or spec type only fails a local run, because
  // Playwright never runs in CI (issue #472).
  it("typechecks the e2e project in the fast job", () => {
    expect(job("checks")).toContain("run: pnpm exec tsc --noEmit -p e2e");
  });

  it("shards the suite and enforces the coverage thresholds only on the merged report", () => {
    const tests = job("tests");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserts the literal GitHub Actions expression in ci.yml.
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

  // A re-run shard uploads a second report under the same name, and
  // download-artifact keeps the one with the higher ID, which can be the old
  // failed one (PR #546). Each attempt gets its own name, and the merge reads
  // only the newest attempt of each shard.
  it("merges only the newest attempt of each shard's report", () => {
    expect(job("tests")).toContain(
      ["name: vitest-blob-$", "{{ matrix.shard }}-attempt-$", "{{ github.run_attempt }}"].join("")
    );
    const coverage = job("coverage");
    expect(coverage).not.toContain("merge-multiple");
    expect(coverage).toContain(
      "run: node scripts/latest-shard-reports.mjs .vitest-artifacts .vitest-reports"
    );
    expect(coverage.indexOf("latest-shard-reports")).toBeLessThan(
      coverage.indexOf("--mergeReports")
    );
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

  // AGENTS.md reached 12,600 words because nothing stopped it growing.
  it("fails a PR whose AGENTS.md is over its word budget", () => {
    const budget = job("agents-budget");
    expect(budget).toContain("run: node scripts/agents-word-budget.mjs AGENTS.md");
    expect(budget).not.toMatch(/needs:|if:|continue-on-error/);
  });

  // The Plugin tooling lane spawns tsx, Vite, tsc, biome, and vitest and takes
  // about 10 seconds: it runs once, after the tests, never in the shards
  // (issue #455).
  it("runs the Plugin tooling lane once, after the unit tests", () => {
    expect(packageJson.scripts["test:plugin-tooling"]).toBe(
      "MAIBUK_PLUGIN_TOOLING=1 vitest run src/test/integration/plugin-tooling.test.ts"
    );
    const tooling = job("plugin-tooling");
    expect(tooling).toContain("needs: tests");
    expect(tooling).toContain("run: pnpm test:plugin-tooling");
    expect(tooling).not.toContain("matrix");
  });
});
