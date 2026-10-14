import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUDGETS,
  checkBudgets,
  median,
  percentile,
} from "../../../../../scripts/plugins-bench-budget.mjs";
import type { PluginsBenchReport } from "../../../../../scripts/plugins-bench-budget.mjs";

function baseReport(overrides: Partial<PluginsBenchReport> = {}): PluginsBenchReport {
  return {
    engine: "chromium",
    launch: { baseline: [100, 100], installed20: [110, 110], persistent3: [105, 105] },
    startToReady: { "maibuk.everything": [50, 50] },
    commandToEffect: [50, 50],
    remoteUiEcho: [10, 10],
    remoteUiBurst: [30, 30],
    ...overrides,
  };
}

describe("plugins bench budget helpers", () => {
  it("median takes the middle value for odd n and averages the two middle values for even n", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("percentile is nearest-rank: sorted ascending, index ceil(p/100*n)-1", () => {
    const samples = Array.from({ length: 100 }, (_, index) => index + 1);
    expect(percentile(samples, 95)).toBe(95);
    expect(percentile(samples, 100)).toBe(100);
    const twenty = Array.from({ length: 20 }, (_, index) => index + 1);
    expect(percentile(twenty, 95)).toBe(19);
  });
});

describe("plugins bench budget check", () => {
  it("freezes the #448 budgets", () => {
    expect(BUDGETS).toEqual({
      launchDeltaFraction: 0.05,
      launchDeltaFloorMs: 20,
      startToReadyP95Ms: 150,
      commandToEffectP95Ms: 100,
      remoteUiEchoP95Ms: 16,
      remoteUiBurstP95Ms: 50,
    });
  });

  it("accepts the optional build profile without changing the check", () => {
    const withBuild = baseReport({ build: "debug" });
    expect(withBuild.build).toBe("debug");
    expect(checkBudgets(withBuild).exitCode).toBe(0);
    // The WebKitGTK lane also records a note about its synthetic events.
    expect(checkBudgets(baseReport({ build: "debug", note: "synthetic events" })).exitCode).toBe(0);
    // The field is optional: a report without it checks the same.
    expect(checkBudgets(baseReport()).exitCode).toBe(0);
  });

  it("passes inside every budget with one row per Plugin id and ms units", () => {
    const result = checkBudgets(baseReport());
    expect(result.exitCode).toBe(0);
    expect(result.rows.map((row) => row.name)).toEqual([
      "launch delta",
      "persistent delta",
      "startToReady maibuk.everything",
      "commandToEffect",
      "remoteUiEcho",
      "remoteUiBurst",
    ]);
    expect(result.rows.every((row) => row.unit === "ms")).toBe(true);
  });

  it("holds the launch delta at the 20 ms floor and fails just past it", () => {
    const pass = checkBudgets(
      baseReport({ launch: { baseline: [100, 100], installed20: [120, 120], persistent3: [100, 100] } })
    );
    expect(pass.exitCode).toBe(0);
    expect(pass.rows.find((row) => row.name === "launch delta")?.budget).toBe(20);

    const fail = checkBudgets(
      baseReport({
        launch: { baseline: [100, 100], installed20: [120.5, 120.5], persistent3: [100, 100] },
      })
    );
    expect(fail.exitCode).toBe(1);
    expect(fail.rows.find((row) => row.name === "launch delta")).toMatchObject({
      budget: 20,
      pass: false,
    });
  });

  it("uses the 5% branch when the baseline median exceeds 400 ms", () => {
    const pass = checkBudgets(
      baseReport({
        launch: { baseline: [1000, 1000], installed20: [1050, 1050], persistent3: [1000, 1000] },
      })
    );
    expect(pass.exitCode).toBe(0);
    expect(pass.rows.find((row) => row.name === "launch delta")?.budget).toBe(50);

    const fail = checkBudgets(
      baseReport({
        launch: { baseline: [1000, 1000], installed20: [1051, 1051], persistent3: [1000, 1000] },
      })
    );
    expect(fail.exitCode).toBe(1);
    expect(fail.rows.find((row) => row.name === "launch delta")?.pass).toBe(false);
  });

  it("holds the persistent delta at the allowance and fails just past it", () => {
    const pass = checkBudgets(
      baseReport({
        launch: { baseline: [100, 100], installed20: [100, 100], persistent3: [120, 120] },
      })
    );
    expect(pass.exitCode).toBe(0);

    const fail = checkBudgets(
      baseReport({
        launch: { baseline: [100, 100], installed20: [100, 100], persistent3: [120.5, 120.5] },
      })
    );
    expect(fail.exitCode).toBe(1);
    expect(fail.rows.find((row) => row.name === "persistent delta")?.pass).toBe(false);
  });

  it("holds the startToReady p95 budget per Plugin id at the boundary", () => {
    for (const [boundary, expected] of [
      [150, 0],
      [150.1, 1],
    ] as const) {
      const result = checkBudgets(baseReport({ startToReady: { "maibuk.everything": [boundary, boundary] } }));
      expect(result.exitCode).toBe(expected);
    }
  });

  it("names the failing startToReady row while the passing id holds", () => {
    const result = checkBudgets(baseReport({ startToReady: { fast: [50, 50], slow: [200, 200] } }));
    expect(result.exitCode).toBe(1);
    expect(result.rows.find((row) => row.name === "startToReady slow")).toMatchObject({
      value: 200,
      budget: 150,
      pass: false,
    });
    expect(result.rows.find((row) => row.name === "startToReady fast")?.pass).toBe(true);
  });

  it("holds the commandToEffect, remoteUiEcho and remoteUiBurst p95 budgets", () => {
    const cases: Array<[string, Partial<PluginsBenchReport>, Partial<PluginsBenchReport>]> = [
      ["commandToEffect", { commandToEffect: [100, 100] }, { commandToEffect: [100.1, 100.1] }],
      ["remoteUiEcho", { remoteUiEcho: [16, 16] }, { remoteUiEcho: [16.1, 16.1] }],
      ["remoteUiBurst", { remoteUiBurst: [50, 50] }, { remoteUiBurst: [50.1, 50.1] }],
    ];
    for (const [name, passOverride, failOverride] of cases) {
      expect(checkBudgets(baseReport(passOverride)).exitCode, name).toBe(0);
      const failed = checkBudgets(baseReport(failOverride));
      expect(failed.exitCode, name).toBe(1);
      expect(failed.rows.find((row) => row.name === name)?.pass).toBe(false);
    }
  });

  it("returns exitCode 1 for a synthetic miss with every sample present", () => {
    expect(checkBudgets(baseReport({ commandToEffect: [200, 200] })).exitCode).toBe(1);
  });

  it("returns exitCode 2 when a required sample array is empty", () => {
    expect(checkBudgets(baseReport({ commandToEffect: [] })).exitCode).toBe(2);
    expect(checkBudgets(baseReport({ startToReady: { "maibuk.everything": [] } })).exitCode).toBe(2);
    const result = checkBudgets(baseReport({ commandToEffect: [] }));
    expect(result.rows.find((row) => row.name === "commandToEffect")).toMatchObject({
      value: null,
      pass: null,
    });
  });

  it("returns exitCode 2 when startToReady has no ids", () => {
    expect(checkBudgets(baseReport({ startToReady: {} })).exitCode).toBe(2);
  });

  it("returns exitCode 2 when unmeasured is non-empty, even with a miss", () => {
    const report = baseReport({ unmeasured: ["remoteUiBurst"], commandToEffect: [200, 200] });
    expect(checkBudgets(report).exitCode).toBe(2);
  });

  it("names why a report cannot be measured", () => {
    expect(checkBudgets(baseReport({ unmeasured: ["no display"] })).reasons).toEqual([
      "no display",
    ]);
    expect(checkBudgets(baseReport({ remoteUiEcho: [], startToReady: {} })).reasons).toEqual([
      "no samples: remoteUiEcho",
      "no on-demand Plugin to start",
    ]);
    expect(checkBudgets(baseReport()).reasons).toEqual([]);
  });
});

const script = join(process.cwd(), "scripts", "plugins-bench-budget.mjs");

function runCli(args: string[]): number {
  try {
    execFileSync(process.execPath, [script, ...args], { stdio: "pipe" });
    return 0;
  } catch (error) {
    return (error as { status?: number }).status ?? -1;
  }
}

describe("plugins bench budget CLI", () => {
  it("exits 2 when the report path is missing or unreadable", () => {
    expect(runCli([])).toBe(2);
    expect(runCli(["/no/such/plugins-bench.json"])).toBe(2);
  });

  it("exits 2 on malformed JSON and 0 on a report inside every budget", () => {
    const dir = mkdtempSync(join(tmpdir(), "plugins-bench-"));
    try {
      const bad = join(dir, "bad.json");
      writeFileSync(bad, "{ not json");
      expect(runCli([bad])).toBe(2);

      const good = join(dir, "good.json");
      writeFileSync(good, JSON.stringify(baseReport()));
      expect(runCli([good])).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
