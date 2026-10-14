// @vitest-environment node
//
// The pure half of the Plugins bench runner (issue #448): argument
// parsing, the worst-exit-code combination, and assembling a PluginsBenchReport
// from the per-measurement JSON the bench specs wrote (`e2e/plugins-bench/report.ts`).
// No browser: these are the runner's decisions, unit-tested on their own.

import { describe, expect, it } from "vitest";
import {
  MEASUREMENT_FILES,
  PLUGINS_BENCH_ENGINES,
  PluginsBenchUsageError,
  assembleReport,
  combineExitCodes,
  parsePluginsBenchArgs,
  shouldBuildPluginFixtures,
  unmeasuredReport,
} from "../../../../../e2e/plugins-bench/report";

describe("parsePluginsBenchArgs", () => {
  it("defaults to both lanes, chromium first, 20 samples, headed", () => {
    const options = parsePluginsBenchArgs([]);
    expect(options.engines).toEqual(["chromium", "webkitgtk"]);
    expect(options.engines).toEqual([...PLUGINS_BENCH_ENGINES]);
    expect(options.samples).toBe(20);
    expect(options.reuseBuild).toBe(false);
    expect(options.headless).toBe(false);
  });

  it("keeps only the named lane, in the order given", () => {
    expect(parsePluginsBenchArgs(["--engine", "webkitgtk"]).engines).toEqual(["webkitgtk"]);
    expect(
      parsePluginsBenchArgs(["--engine", "webkitgtk", "--engine", "chromium"]).engines
    ).toEqual(["webkitgtk", "chromium"]);
    // A comma list and a repeated flag both work, and a repeat is de-duplicated.
    expect(
      parsePluginsBenchArgs(["--engine=chromium,webkitgtk", "--engine", "chromium"]).engines
    ).toEqual(["chromium", "webkitgtk"]);
  });

  it("reads --samples, --reuse-build and --headless", () => {
    const options = parsePluginsBenchArgs(["--samples", "10", "--reuse-build", "--headless"]);
    expect(options.samples).toBe(10);
    expect(options.reuseBuild).toBe(true);
    expect(options.headless).toBe(true);
  });

  it("accepts --samples=<n> inline", () => {
    expect(parsePluginsBenchArgs(["--samples=7"]).samples).toBe(7);
  });

  it("rejects an unknown engine, a bad --samples, and an unknown option", () => {
    expect(() => parsePluginsBenchArgs(["--engine", "gecko"])).toThrow(PluginsBenchUsageError);
    for (const bad of ["0", "-1", "1.5", "lots"]) {
      expect(() => parsePluginsBenchArgs(["--samples", bad])).toThrow(PluginsBenchUsageError);
    }
    expect(() => parsePluginsBenchArgs(["--nope"])).toThrow(PluginsBenchUsageError);
    expect(() => parsePluginsBenchArgs(["--engine"])).toThrow(PluginsBenchUsageError);
  });
});

describe("combineExitCodes", () => {
  it("returns the worst code: 2 beats 1 beats 0", () => {
    expect(combineExitCodes([])).toBe(0);
    expect(combineExitCodes([0, 0])).toBe(0);
    expect(combineExitCodes([0, 1])).toBe(1);
    expect(combineExitCodes([1, 0])).toBe(1);
    expect(combineExitCodes([1, 2])).toBe(2);
    expect(combineExitCodes([2, 0, 1])).toBe(2);
    expect(combineExitCodes([1, 2, 0])).toBe(2);
  });
});

describe("shouldBuildPluginFixtures", () => {
  it("builds on every run, so the WebKitGTK lane alone still finds the folders", () => {
    expect(shouldBuildPluginFixtures(false, false)).toBe(true);
    expect(shouldBuildPluginFixtures(false, true)).toBe(true);
  });

  it("skips the build under --reuse-build only when every folder already exists", () => {
    expect(shouldBuildPluginFixtures(true, true)).toBe(false);
    // The folders are missing: even --reuse-build must build them.
    expect(shouldBuildPluginFixtures(true, false)).toBe(true);
  });
});

function file(name: string, data: unknown): { name: string; text: string } {
  return { name, text: JSON.stringify(data) };
}

function completeFiles(): { name: string; text: string }[] {
  return [
    file(MEASUREMENT_FILES.launchBaseline, [100, 101]),
    file(MEASUREMENT_FILES.launchInstalled20, [110, 111]),
    file(MEASUREMENT_FILES.launchPersistent3, [105, 106]),
    file(MEASUREMENT_FILES.startToReady, { "fixture-everything-on-demand": [40, 41] }),
    file(MEASUREMENT_FILES.commandToEffect, [20, 21]),
    file(MEASUREMENT_FILES.remoteUiEcho, { samples: [8, 9], textLost: false }),
    file(MEASUREMENT_FILES.remoteUiBurst, { samples: [30, 31], textLost: false }),
    file(MEASUREMENT_FILES.echoHighlightUpdate, [5, 6]),
    file(MEASUREMENT_FILES.echoWorkerRecompute, [3, 4]),
    file(MEASUREMENT_FILES.echoRefreshLatency, [320, 321]),
  ];
}

describe("assembleReport", () => {
  it("assembles every measurement, with no unmeasured reasons", () => {
    const report = assembleReport("chromium", completeFiles());
    expect(report.engine).toBe("chromium");
    expect(report.unmeasured).toBeUndefined();
    expect(report.launch).toEqual({
      baseline: [100, 101],
      installed20: [110, 111],
      persistent3: [105, 106],
    });
    expect(report.startToReady).toEqual({ "fixture-everything-on-demand": [40, 41] });
    expect(report.commandToEffect).toEqual([20, 21]);
    expect(report.remoteUiEcho).toEqual([8, 9]);
    expect(report.remoteUiBurst).toEqual([30, 31]);
    expect(report.remoteUiEchoTextLost).toBe(false);
    expect(report.remoteUiBurstTextLost).toBe(false);
    expect(report.echoHighlightUpdate).toEqual([5, 6]);
    expect(report.echoWorkerRecompute).toEqual([3, 4]);
    expect(report.echoRefreshLatency).toEqual([320, 321]);
  });

  it("requires the Echoes rows on Chromium but not on WebKitGTK (#451)", () => {
    const withoutEchoes = completeFiles().filter((entry) =>
      (["echoHighlightUpdate", "echoWorkerRecompute", "echoRefreshLatency"] as const).every(
        (key) => MEASUREMENT_FILES[key] !== entry.name
      )
    );
    const chromium = assembleReport("chromium", withoutEchoes);
    expect(chromium.unmeasured).toEqual([
      `${MEASUREMENT_FILES.echoHighlightUpdate}: no measurement was written`,
      `${MEASUREMENT_FILES.echoWorkerRecompute}: no measurement was written`,
      `${MEASUREMENT_FILES.echoRefreshLatency}: no measurement was written`,
    ]);
    const webkit = assembleReport("webkitgtk", withoutEchoes);
    expect(webkit.unmeasured).toBeUndefined();
    expect(webkit.echoHighlightUpdate).toBeUndefined();
  });

  it("carries a lost echo/burst text as a flag beside the samples it gathered", () => {
    const files = completeFiles().map((entry) =>
      entry.name === MEASUREMENT_FILES.remoteUiBurst
        ? file(entry.name, { samples: [30, 31], textLost: true })
        : entry
    );
    const report = assembleReport("chromium", files);
    expect(report.remoteUiBurst).toEqual([30, 31]);
    expect(report.remoteUiBurstTextLost).toBe(true);
    expect(report.remoteUiEchoTextLost).toBe(false);
    expect(report.unmeasured).toBeUndefined();
  });

  it("names every missing measurement as unmeasured and leaves its samples empty", () => {
    const files = completeFiles().filter(
      (entry) => entry.name !== MEASUREMENT_FILES.commandToEffect
    );
    const report = assembleReport("chromium", files);
    expect(report.unmeasured).toEqual([
      `${MEASUREMENT_FILES.commandToEffect}: no measurement was written`,
    ]);
    expect(report.commandToEffect).toEqual([]);
    // The measurements that were present stay.
    expect(report.remoteUiEcho).toEqual([8, 9]);
  });

  it("reports invalid JSON and a wrong shape as unmeasured", () => {
    const files = completeFiles().map((entry) =>
      entry.name === MEASUREMENT_FILES.remoteUiEcho
        ? { name: entry.name, text: "{ not json" }
        : entry.name === MEASUREMENT_FILES.remoteUiBurst
          ? file(entry.name, { nope: true })
          : entry
    );
    const report = assembleReport("chromium", files);
    expect(report.unmeasured).toEqual([
      `${MEASUREMENT_FILES.remoteUiEcho}: invalid JSON`,
      `${MEASUREMENT_FILES.remoteUiBurst}: expected echo samples`,
    ]);
    expect(report.remoteUiEcho).toEqual([]);
    expect(report.remoteUiBurst).toEqual([]);
  });

  it("maps the webkitgtk lane to the report's webkit engine", () => {
    expect(assembleReport("webkitgtk", completeFiles()).engine).toBe("webkit");
  });
});

describe("unmeasuredReport", () => {
  it("carries the reasons and empty samples, so the budget check cannot pass", () => {
    const report = unmeasuredReport("webkitgtk", ["webkitgtk lane not implemented"]);
    expect(report.engine).toBe("webkit");
    expect(report.unmeasured).toEqual(["webkitgtk lane not implemented"]);
    expect(report.launch).toEqual({ baseline: [], installed20: [], persistent3: [] });
    expect(report.startToReady).toEqual({});
    expect(report.commandToEffect).toEqual([]);
    expect(report.remoteUiEcho).toEqual([]);
    expect(report.remoteUiBurst).toEqual([]);
  });
});
