import { readFileSync } from "node:fs";
import { matchesGlob, resolve } from "node:path";
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

  // `pnpm lint` fails on Biome warnings, infos, and unformatted files, and the
  // deprecation gate needs the compiler API, so both live in the fast job (#670).
  it("runs the strict lint and the deprecation gate in the fast job", () => {
    const checks = job("checks");
    expect(checks).toContain("run: pnpm lint");
    expect(checks).toContain("run: pnpm check:deprecated");
    expect(packageJson.scripts.lint).toBe("node scripts/lint.mjs");
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
    expect(coverage).toContain("needs: [changes, tests]");
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
    expect(coverage).toContain(
      ["if: $", "{{ !cancelled() && needs.changes.outputs.full == 'true' }}"].join("")
    );
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
  // about 10 seconds: it runs once, never in the shards (issue #455), beside
  // the tests and only when a Plugin path changed (issue #853).
  it("runs the Plugin tooling lane once, beside the tests, only for Plugin changes", () => {
    expect(packageJson.scripts["test:plugin-tooling"]).toBe(
      "MAIBUK_PLUGIN_TOOLING=1 vitest run src/test/integration/plugin-tooling.test.ts"
    );
    const tooling = job("plugin-tooling");
    expect(tooling).toContain("needs: changes");
    expect(tooling).toContain(["if: $", "{{ needs.changes.outputs.plugin == 'true' }}"].join(""));
    expect(tooling).toContain("run: pnpm test:plugin-tooling");
    expect(tooling).not.toContain("matrix");
  });

  // A PR pays for the tests its diff reaches, not the whole suite; the guards
  // cover the tests that read the repo from disk, which the import graph
  // cannot see (issue #853).
  it("runs only the tests a PR reaches, plus the guards, unless a trigger changed", () => {
    expect(job("tests")).toContain(
      ["if: $", "{{ needs.changes.outputs.full == 'true' }}"].join("")
    );
    const changed = job("tests-changed");
    expect(changed).toContain(["if: $", "{{ needs.changes.outputs.full == 'false' }}"].join(""));
    expect(changed).toContain('run: pnpm exec vitest run --changed "$BASE"');
    expect(changed).toContain("run: pnpm test:guards");
    expect(changed).not.toContain("--coverage");
  });

  // CI's full-run list and Vitest's forceRerunTriggers are two spellings of
  // one list: a local `vitest --changed` must widen to the whole suite exactly
  // when CI does.
  it("widens to the full suite on the same files as vitest --changed", () => {
    const fullRun = new RegExp(job("changes").match(/FULL_RUN='([^']+)'/)?.[1] ?? "^$");
    const viteConfig = readFileSync(resolve(__dirname, "../../../vite.config.ts"), "utf8");
    const triggers = [
      ...(viteConfig.match(/forceRerunTriggers: \[([\s\S]*?)\]/)?.[1] ?? "").matchAll(/"([^"]+)"/g),
    ].map((m) => m[1]);
    const forcesRerun = (file: string) =>
      triggers.some((glob) => matchesGlob(`/repo/${file}`, glob));

    const cases: Array<[string, boolean]> = [
      ["package.json", true],
      ["pnpm-lock.yaml", true],
      ["vite.config.ts", true],
      ["tsconfig.json", true],
      ["tsconfig.node.json", true],
      ["src/test/setup.ts", true],
      ["src/test/support/time-budget-reporter.ts", true],
      [".github/workflows/ci.yml", true],
      ["src/lib/async-queue.ts", false],
      ["src/test/unit/ci-workflow.test.ts", false],
      ["docs/agents/design.md", false],
    ];
    for (const [file, full] of cases) {
      expect({ file, ci: fullRun.test(file), vitest: forcesRerun(file) }).toEqual({
        file,
        ci: full,
        vitest: full,
      });
    }
  });

  // Every push to main and the nightly run take the full suite, and a red main
  // opens or updates one bug issue, since nobody watches the Actions tab.
  it("runs the full suite on main and nightly and reports a failure as an issue", () => {
    expect(workflow).toMatch(/\n {2}push:\n {4}branches:\n {6}- main\n/);
    expect(workflow).toMatch(/\n {2}schedule:\n {4}- cron: /);
    const report = job("report-failure");
    expect(report).toContain(
      ["if: $", "{{ failure() && github.event_name != 'pull_request' }}"].join("")
    );
    expect(report).toContain("needs: [checks, agents-budget, tests, coverage, plugin-tooling]");
    expect(report).toContain("issues: write");
    expect(report).toContain("--label bug");
  });
});
