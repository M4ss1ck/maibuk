import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  CARGO_LOCK_PATH,
  GATE_RESULTS_PATH,
  checkConformanceGate,
  readCargoLockVersions,
} from "../../../scripts/plugin-conformance-gate.mjs";

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
    expect(readCargoLockVersions(cargoLock)).toEqual({ tauri: "2.9.5", wry: "0.53.5" });
  });

  it("reports null for a gated package the lock does not name", () => {
    expect(readCargoLockVersions(withoutPackage("wry"))).toEqual({ tauri: "2.9.5", wry: null });
  });

  it("throws, naming the package and both versions, when a package appears twice", () => {
    const duplicated = `${cargoLock}\n[[package]]\nname = "tauri"\nversion = "2.10.0"\n`;
    expect(() => readCargoLockVersions(duplicated)).toThrow(/tauri.*2\.9\.5.*2\.10\.0/);
  });
});

describe("checkConformanceGate()", () => {
  it("passes on the real Cargo.lock and the recorded results", () => {
    expect(checkConformanceGate(cargoLock, results)).toEqual({ ok: true, problems: [] });
  });

  it("fails on a bumped tauri, naming the package, the lock version and the recorded one", () => {
    const { ok, problems } = checkConformanceGate(
      withVersion(cargoLock, "tauri", "2.9.5", "2.10.0"),
      results
    );
    expect(ok).toBe(false);
    const report = problems.join("\n");
    expect(report).toContain("tauri");
    expect(report).toContain("2.10.0");
    expect(report).toContain("2.9.5");
  });

  it("fails on a bumped wry, naming the package, the lock version and the recorded one", () => {
    const { ok, problems } = checkConformanceGate(
      withVersion(cargoLock, "wry", "0.53.5", "0.54.0"),
      results
    );
    expect(ok).toBe(false);
    const report = problems.join("\n");
    expect(report).toContain("wry");
    expect(report).toContain("0.54.0");
    expect(report).toContain("0.53.5");
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
    const duplicated = `${cargoLock}\n[[package]]\nname = "tauri"\nversion = "2.10.0"\n`;
    const { ok, problems } = checkConformanceGate(duplicated, results);
    expect(ok).toBe(false);
    expect(problems.join("\n")).toContain("tauri");
    expect(problems.join("\n")).toContain("2.10.0");
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
