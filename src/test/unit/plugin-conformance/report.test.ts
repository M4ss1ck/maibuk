import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { CARGO_LOCK_PATH } from "../../../../scripts/plugin-conformance-gate.mjs";
import {
  CONFORMANCE_RESULTS_SCHEMA,
  CONFORMANCE_UNSUPPORTED_FOLLOW_UP,
  type ConformanceStack,
  type PlatformOutcome,
  buildPlatformRun,
  canRecord,
  classifyRun,
  emptyResultsFile,
  exitCodeForChecks,
  finalizeRun,
  formatConformanceTable,
  isHostUnsupportedLanePlatform,
  laneExitCode,
  mergePlatformRun,
  mergeRunEngine,
  stackFromCargoLock,
} from "@/test/support/plugin-conformance/report";
import {
  type CollectorState,
  applyCollectorRequest,
  initialCollectorState,
} from "@/test/support/plugin-conformance/collector-state";
import type { ConformanceCheck } from "@/features/plugins/conformance/types";

const ENGINE = { name: "tauri-webkitgtk", version: "60.5", userAgent: "UA" };

function check(id: string, status: ConformanceCheck["status"]): ConformanceCheck {
  return { id, status, detail: `${id} ${status}` };
}

function stateOf(requests: Parameters<typeof applyCollectorRequest>[1][]): CollectorState {
  return requests.reduce(
    (state, request) => applyCollectorRequest(state, request).state,
    initialCollectorState()
  );
}

const T7 = check("T7-hang", "pass");

describe("exitCodeForChecks()", () => {
  it("is 2 when no check arrived", () => {
    expect(exitCodeForChecks([])).toBe(2);
  });

  it("is 0 when every check passed", () => {
    expect(exitCodeForChecks([check("a", "pass"), check("b", "pass")])).toBe(0);
  });

  it("is 1 when a check failed", () => {
    expect(exitCodeForChecks([check("a", "pass"), check("b", "fail")])).toBe(1);
  });

  it("is 2 when any check is unmeasured, even beside a fail", () => {
    expect(exitCodeForChecks([check("a", "unmeasured")])).toBe(2);
    expect(exitCodeForChecks([check("a", "fail"), check("b", "unmeasured")])).toBe(2);
  });
});

describe("classifyRun()", () => {
  it("uses the whole result when it arrived", () => {
    const state = stateOf([
      { method: "POST", path: "/result", body: { engine: ENGINE, checks: [T7] } },
      { method: "POST", path: "/done" },
    ]);
    expect(classifyRun(state, { processDied: false })).toEqual({ kind: "done", checks: [T7] });
  });

  it("is a T8 renderer death when the process died with T7 settled and T8 in flight", () => {
    const state = stateOf([{ method: "POST", path: "/progress", body: T7 }]);
    const completion = classifyRun(state, { processDied: true });
    expect(completion.kind).toBe("renderer-died");
    if (completion.kind !== "renderer-died") throw new Error("expected renderer-died");
    expect(completion.checks).toEqual([
      T7,
      { id: "T8-oom", status: "fail", detail: "renderer-died" },
    ]);
  });

  it("is incomplete when the process died before T7", () => {
    const state = stateOf([{ method: "POST", path: "/progress", body: check("T2-worker-ipc", "pass") }]);
    expect(classifyRun(state, { processDied: true })).toEqual({ kind: "incomplete" });
  });

  it("is incomplete when it never finished and the process stayed alive", () => {
    const state = stateOf([{ method: "POST", path: "/progress", body: T7 }]);
    expect(classifyRun(state, { processDied: false })).toEqual({ kind: "incomplete" });
  });
});

describe("finalizeRun()", () => {
  it("exits 2 with no checks when nothing arrived", () => {
    const outcome = finalizeRun(initialCollectorState(), { processDied: false });
    expect(outcome.exitCode).toBe(2);
    expect(outcome.note).toBe("no checks arrived");
  });

  it("exits 1 and names the renderer death for a T8 in flight", () => {
    const state = stateOf([{ method: "POST", path: "/progress", body: T7 }]);
    const outcome = finalizeRun(state, { processDied: true });
    expect(outcome.exitCode).toBe(1);
    expect(outcome.note).toContain("renderer died");
  });

  it("exits 0 when the result has every check passing", () => {
    const state = stateOf([
      { method: "POST", path: "/result", body: { engine: ENGINE, checks: [T7, check("T8-oom", "pass")] } },
      { method: "POST", path: "/done" },
    ]);
    const outcome = finalizeRun(state, { processDied: false });
    expect(outcome.exitCode).toBe(0);
  });
});

describe("canRecord()", () => {
  const outcome = (exitCode: PlatformOutcome["exitCode"]): PlatformOutcome => ({
    checks: [],
    exitCode,
    note: "",
  });
  it("records a MEASURED platform, pass or fail, but never an exit-2 run", () => {
    expect(canRecord(outcome(0))).toBe(true);
    expect(canRecord(outcome(1))).toBe(true);
    expect(canRecord(outcome(2))).toBe(false);
  });
});

describe("isHostUnsupportedLanePlatform()", () => {
  it("is true for Android (the v1 rule) and false for Linux", () => {
    expect(isHostUnsupportedLanePlatform("android")).toBe(true);
    expect(isHostUnsupportedLanePlatform("linux")).toBe(false);
  });
});

describe("stackFromCargoLock()", () => {
  const cargoLock = readFileSync(CARGO_LOCK_PATH, "utf8");

  it("reads tauri and wry from the real Cargo.lock", () => {
    expect(stackFromCargoLock(cargoLock)).toEqual({ tauri: "2.9.5", wry: "0.53.5" });
  });

  it("merges a platform's WebView version", () => {
    expect(stackFromCargoLock(cargoLock, { webkitgtk: "2.52.6" })).toEqual({
      tauri: "2.9.5",
      wry: "0.53.5",
      webkitgtk: "2.52.6",
    });
  });

  it("ignores tauri-* siblings and reads a synthetic lock", () => {
    const text = [
      '[[package]]\nname = "tauri"\nversion = "9.9.9"',
      '[[package]]\nname = "tauri-build"\nversion = "1.0.0"',
      '[[package]]\nname = "wry"\nversion = "8.8.8"',
    ].join("\n");
    expect(stackFromCargoLock(text)).toEqual({ tauri: "9.9.9", wry: "8.8.8" });
  });
});

describe("buildPlatformRun()", () => {
  it("carries the engine, checks, time, device and exit code", () => {
    expect(
      buildPlatformRun({
        platform: "linux",
        engine: ENGINE,
        checks: [T7],
        ranAt: "2026-10-13T00:00:00.000Z",
        device: "pixel",
        exit: 0,
      })
    ).toEqual({
      ranAt: "2026-10-13T00:00:00.000Z",
      engine: ENGINE,
      device: "pixel",
      exit: 0,
      checks: [T7],
    });
  });

  it("omits the device when there is none", () => {
    const run = buildPlatformRun({ platform: "linux", engine: ENGINE, checks: [T7], ranAt: "t", exit: 1 });
    expect("device" in run).toBe(false);
  });

  it("marks an Android run unsupported-in-v1 with the #492 follow-up, keeping its exit", () => {
    const run = buildPlatformRun({ platform: "android", engine: ENGINE, checks: [T7], ranAt: "t", exit: 1 });
    expect(run).toMatchObject({
      exit: 1,
      support: "unsupported-in-v1",
      followUp: CONFORMANCE_UNSUPPORTED_FOLLOW_UP,
    });
    expect(run.followUp).toBe("#492");
  });

  it("leaves a host-supported run without a support marker", () => {
    const run = buildPlatformRun({ platform: "linux", engine: ENGINE, checks: [T7], ranAt: "t", exit: 0 });
    expect("support" in run).toBe(false);
    expect("followUp" in run).toBe(false);
  });
});

describe("mergeRunEngine()", () => {
  const run = { name: "tauri-webkitgtk", version: "v0.11.0", userAgent: "UA" };

  it("takes the measured engine version over the run's own app version", () => {
    expect(mergeRunEngine({ run, platform: "linux", version: "2.52.6" })).toEqual({
      name: "tauri-webkitgtk",
      version: "2.52.6",
      userAgent: "UA",
    });
  });

  it("uses the Android WebView version and the Android fallback name", () => {
    expect(
      mergeRunEngine({ run: null, platform: "android", version: "113.0.5672.136", userAgent: null })
    ).toEqual({ name: "android-webview", version: "113.0.5672.136", userAgent: "unknown" });
  });

  it("keeps the userAgent from the first request that carried it", () => {
    expect(mergeRunEngine({ run: null, platform: "android", userAgent: "UA-progress" }).userAgent).toBe(
      "UA-progress"
    );
  });

  it("falls back to the run's version and unknown when nothing was measured", () => {
    expect(mergeRunEngine({ run, platform: "linux" })).toEqual(run);
    expect(mergeRunEngine({ run: null, platform: "linux" })).toEqual({
      name: "tauri-webkitgtk",
      version: "unknown",
      userAgent: "unknown",
    });
  });
});

describe("mergePlatformRun()", () => {
  const stack: ConformanceStack = { tauri: "2.9.5", wry: "0.53.5", webkitgtk: "2.52.6" };
  const run = buildPlatformRun({
    platform: "linux",
    engine: ENGINE,
    checks: [T7],
    ranAt: "2026-10-13T00:00:00.000Z",
    exit: 0,
  });

  it("creates the file from nothing with the schema id", () => {
    const file = mergePlatformRun(null, "linux", run, stack, "now");
    expect(file.schema).toBe(CONFORMANCE_RESULTS_SCHEMA);
    expect(file.recordedAt).toBe("now");
    expect(file.platforms.linux).toEqual(run);
  });

  it("keeps the other platform and the WebView versions it measured", () => {
    const first = mergePlatformRun(null, "linux", run, stack, "now");
    const androidStack: ConformanceStack = { tauri: "2.9.5", wry: "0.53.5", androidWebView: "113.0" };
    const second = mergePlatformRun(first, "android", run, androidStack, "later");
    expect(second.platforms.linux).toEqual(run);
    expect(second.platforms.android).toEqual(run);
    expect(second.stack).toEqual({
      tauri: "2.9.5",
      wry: "0.53.5",
      webkitgtk: "2.52.6",
      androidWebView: "113.0",
    });
    expect(second.recordedAt).toBe("later");
  });
});

describe("emptyResultsFile()", () => {
  it("has the schema id and no platforms", () => {
    const file = emptyResultsFile("now", { tauri: "1", wry: "2" });
    expect(file).toEqual({ schema: CONFORMANCE_RESULTS_SCHEMA, recordedAt: "now", stack: { tauri: "1", wry: "2" }, platforms: {} });
  });
});

describe("laneExitCode()", () => {
  const summary = (platform: "linux" | "android", exitCode: 0 | 1 | 2) => ({
    platform,
    outcome: { checks: [], exitCode, note: "" },
    leaks: 0,
    engine: null,
  });

  it("is 2 when no platform ran", () => {
    expect(laneExitCode([])).toBe(2);
  });

  it("takes the worst platform", () => {
    expect(laneExitCode([summary("linux", 0), summary("android", 0)])).toBe(0);
    expect(laneExitCode([summary("linux", 0), summary("android", 1)])).toBe(1);
    expect(laneExitCode([summary("linux", 1), summary("android", 2)])).toBe(2);
  });
});

describe("formatConformanceTable()", () => {
  it("prints a row per platform and lists the non-passing checks", () => {
    const table = formatConformanceTable([
      {
        platform: "linux",
        outcome: { checks: [check("T7-hang", "pass"), check("T8-oom", "fail")], exitCode: 1, note: "check failed" },
        leaks: 0,
        engine: ENGINE,
      },
    ]);
    expect(table).toContain("| linux | 1 |");
    expect(table).toContain("tauri-webkitgtk 60.5");
    expect(table).toContain("linux: T8-oom fail: T8-oom fail");
    expect(table).not.toContain("T7-hang fail");
  });

  it("says so when nothing ran", () => {
    expect(formatConformanceTable([])).toContain("no platform ran");
  });
});
