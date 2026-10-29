import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  CARGO_LOCK_PATH,
  GATE_RESULTS_PATH,
  WINDOWS_FRAME_CHECK_IDS,
  WINDOWS_FRAME_PLATFORM,
  checkConformanceGate,
  checkWindowsFrameRecord,
  readCargoLockVersions,
} from "../../../scripts/plugin-conformance-gate.mjs";
import { WINDOWS_FRAME_CHECK_IDS as APP_WINDOWS_FRAME_CHECK_IDS } from "@/features/plugins/windows-frame-record";

const cargoLock = readFileSync(CARGO_LOCK_PATH, "utf8");
const results = JSON.parse(readFileSync(GATE_RESULTS_PATH, "utf8"));

/** The real lock with one gated package's version rewritten. */
function withVersion(text: string, pkg: string, from: string, to: string): string {
  const marker = `name = "${pkg}"\nversion = "${from}"`;
  expect(text, `Cargo.lock has no ${pkg} ${from}`).toContain(marker);
  return text.replace(marker, `name = "${pkg}"\nversion = "${to}"`);
}

/** The real lock with one gated package's whole `[[package]]` block dropped. */
function withoutPackage(pkg: string): string {
  const from = cargoLock.indexOf(`\n[[package]]\nname = "${pkg}"\n`);
  expect(from, `Cargo.lock has no ${pkg} package`).toBeGreaterThan(-1);
  const to = cargoLock.indexOf("\n[[package]]", from + 1);
  return cargoLock.slice(0, from + 1) + (to === -1 ? "" : cargoLock.slice(to + 1));
}

describe("readCargoLockVersions()", () => {
  it("reads the exact tauri and wry entries, ignoring tauri-* siblings", () => {
    expect(readCargoLockVersions(cargoLock)).toEqual({ tauri: "2.12.4", wry: "0.57.1" });
  });

  it("reports null for a gated package the lock does not name", () => {
    expect(readCargoLockVersions(withoutPackage("wry"))).toEqual({ tauri: "2.12.4", wry: null });
  });

  it("throws, naming the package and both versions, when a package appears twice", () => {
    const duplicated = `${cargoLock}\n[[package]]\nname = "tauri"\nversion = "2.13.0"\n`;
    expect(() => readCargoLockVersions(duplicated)).toThrow(/tauri.*2\.12\.4.*2\.13\.0/);
  });
});

describe("checkConformanceGate()", () => {
  it("passes on the real Cargo.lock and the recorded results", () => {
    expect(checkConformanceGate(cargoLock, results)).toEqual({ ok: true, problems: [] });
  });

  it("fails on a bumped tauri, naming the package, the lock version and the recorded one", () => {
    const { ok, problems } = checkConformanceGate(
      withVersion(cargoLock, "tauri", "2.12.4", "2.13.0"),
      results
    );
    expect(ok).toBe(false);
    const report = problems.join("\n");
    expect(report).toContain("tauri");
    expect(report).toContain("2.13.0");
    expect(report).toContain("2.12.4");
  });

  it("fails on a bumped wry, naming the package, the lock version and the recorded one", () => {
    const { ok, problems } = checkConformanceGate(
      withVersion(cargoLock, "wry", "0.57.1", "0.58.0"),
      results
    );
    expect(ok).toBe(false);
    const report = problems.join("\n");
    expect(report).toContain("wry");
    expect(report).toContain("0.58.0");
    expect(report).toContain("0.57.1");
  });

  it("fails when the results record no stack.wry", () => {
    const { ok, problems } = checkConformanceGate(cargoLock, {
      ...results,
      stack: { tauri: results.stack.tauri },
    });
    expect(ok).toBe(false);
    expect(problems.join("\n")).toContain("stack.wry");
  });

  it("fails when Cargo.lock has no wry package", () => {
    const { ok, problems } = checkConformanceGate(withoutPackage("wry"), results);
    expect(ok).toBe(false);
    expect(problems.join("\n")).toContain("wry");
  });

  it("fails when tauri appears with two versions", () => {
    const duplicated = `${cargoLock}\n[[package]]\nname = "tauri"\nversion = "2.13.0"\n`;
    const { ok, problems } = checkConformanceGate(duplicated, results);
    expect(ok).toBe(false);
    expect(problems.join("\n")).toContain("tauri");
    expect(problems.join("\n")).toContain("2.13.0");
  });
});

/** A committed `platforms.windows` slot with every Frame check passing. */
function windowsRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ranAt: "2026-10-15T00:00:00.000Z",
    engine: { name: "tauri-webview2", version: "1.2.3.4", userAgent: "Mozilla/5.0" },
    appVersion: "0.11.0",
    commit: "abc1234",
    ranBy: "Andy",
    exit: 0,
    checks: WINDOWS_FRAME_CHECK_IDS.map((id) => ({ id, status: "pass", detail: "ok" })),
    ...overrides,
  };
}

/** The real results with one `platforms.windows` slot added. */
function withWindowsRecord(record: unknown): typeof results {
  return {
    ...results,
    platforms: { ...results.platforms, [WINDOWS_FRAME_PLATFORM]: record },
  } as typeof results;
}

describe("checkConformanceGate() Windows record (#454 D6)", () => {
  it("allows the real results file, which has no windows slot (not run yet)", () => {
    expect(checkConformanceGate(cargoLock, results)).toEqual({ ok: true, problems: [] });
  });

  it("allows a well-formed Windows record", () => {
    expect(checkConformanceGate(cargoLock, withWindowsRecord(windowsRecord()))).toEqual({
      ok: true,
      problems: [],
    });
  });

  it("allows a Windows record whose check failed (exit 1 is a measured run)", () => {
    const failed = windowsRecord({
      exit: 1,
      checks: WINDOWS_FRAME_CHECK_IDS.map((id) => ({
        id,
        status: id === "frame-no-network" ? "fail" : "pass",
        detail: "detail",
      })),
    });
    expect(checkConformanceGate(cargoLock, withWindowsRecord(failed))).toEqual({
      ok: true,
      problems: [],
    });
  });

  it("fails a Windows record missing a required Frame check", () => {
    const partial = windowsRecord({
      checks: [{ id: "frame-no-network", status: "pass", detail: "ok" }],
    });
    const { ok, problems } = checkConformanceGate(cargoLock, withWindowsRecord(partial));
    expect(ok).toBe(false);
    const report = problems.join("\n");
    expect(report).toContain("platforms.windows.checks");
    expect(report).toContain("frame-no-tauri-ipc");
  });

  it("fails a Windows record with no checks array at all", () => {
    const withoutChecks = windowsRecord();
    delete (withoutChecks as { checks?: unknown }).checks;
    const { ok, problems } = checkConformanceGate(cargoLock, withWindowsRecord(withoutChecks));
    expect(ok).toBe(false);
    expect(problems.join("\n")).toContain("platforms.windows.checks");
  });

  it("fails a Windows record missing the audit fields, naming each", () => {
    const incomplete = windowsRecord();
    delete (incomplete as { ranBy?: unknown }).ranBy;
    delete (incomplete as { appVersion?: unknown }).appVersion;
    const { ok, problems } = checkConformanceGate(cargoLock, withWindowsRecord(incomplete));
    expect(ok).toBe(false);
    const report = problems.join("\n");
    expect(report).toContain("platforms.windows.ranBy");
    expect(report).toContain("platforms.windows.appVersion");
  });

  it("fails a Windows record with a bad exit code and a malformed check", () => {
    const bad = windowsRecord({
      exit: 2,
      checks: [{ id: "frame-no-network", status: "escaped", detail: "ok" }],
    });
    const { ok, problems } = checkConformanceGate(cargoLock, withWindowsRecord(bad));
    expect(ok).toBe(false);
    const report = problems.join("\n");
    expect(report).toContain("platforms.windows.exit");
    expect(report).toContain("malformed check");
  });

  it("reports the slot itself when it is not an object", () => {
    expect(checkWindowsFrameRecord(null)).toEqual(["platforms.windows must be an object"]);
    const { ok, problems } = checkConformanceGate(cargoLock, withWindowsRecord("nope"));
    expect(ok).toBe(false);
    expect(problems.join("\n")).toContain("platforms.windows must be an object");
  });
});

describe("Windows Frame check ids agree across the gate and the app (#454 D6)", () => {
  it("lists the same required ids in the gate script and the app module", () => {
    expect([...WINDOWS_FRAME_CHECK_IDS].sort()).toEqual([...APP_WINDOWS_FRAME_CHECK_IDS].sort());
  });
});

describe("plugin-conformance-gate CLI", () => {
  it("is green on the real repo files", () => {
    const result = spawnSync(
      process.execPath,
      [resolve(__dirname, "../../../scripts/plugin-conformance-gate.mjs")],
      { encoding: "utf8" }
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("matches");
  });
});
