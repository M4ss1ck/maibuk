// @vitest-environment node
//
// Guard for Update's release wiring (ADR 0037). A config edit can silently
// break Update for every install: a missing public key, unsigned updater
// files, or an Arch build that keeps the AppImage marker. This reads the repo
// from disk so `pnpm test:guards` catches it.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const read = (path: string) => readFileSync(`${root}/${path}`, "utf8");

const tauriConf = JSON.parse(read("src-tauri/tauri.conf.json"));
const release = read(".github/workflows/release.yml");

function job(name: string): string {
  const start = release.indexOf(`\n  ${name}:`);
  expect(start, `release.yml has no ${name} job`).toBeGreaterThan(-1);
  const next = release.slice(start + 1).search(/\n {2}[a-z0-9-]+:\n/);
  return next < 0 ? release.slice(start) : release.slice(start, start + 1 + next);
}

describe("Update release config", () => {
  it("carries a minisign public key and the latest-Release feed", () => {
    const { pubkey, endpoints } = tauriConf.plugins.updater;
    expect(Buffer.from(pubkey, "base64").toString("utf8")).toMatch(
      /^untrusted comment: minisign public key/
    );
    expect(endpoints).toEqual([
      "https://github.com/M4ss1ck/maibuk/releases/latest/download/latest.json",
    ]);
  });

  it("creates updater files", () => {
    expect(tauriConf.bundle.createUpdaterArtifacts).toBe(true);
  });

  it.each(["build-linux", "build-windows"])("%s signs with the updater secrets", (name) => {
    const text = job(name);
    for (const name of ["TAURI_SIGNING_PRIVATE_KEY", "TAURI_SIGNING_PRIVATE_KEY_PASSWORD"]) {
      expect(text).toContain(`${name}: \${{ secrets.${name} }}`);
    }
  });

  it("refuses a Release that still carries the development key", () => {
    expect(job("prepare")).toContain("DEV_KEY_ID=");
  });

  it("clears the bundle-type marker before the Arch package repackages the binary", () => {
    expect(read("scripts/build-arch-package.sh")).toMatch(/clear-bundle-type\.mjs.*\/maibuk/);
  });

  it("grants the updater only where the plugin is built (Linux and Windows)", () => {
    const updater = JSON.parse(read("src-tauri/capabilities/updater.json"));
    expect(updater.platforms).toEqual(["linux", "windows"]);
    expect(updater.permissions).toEqual(
      expect.arrayContaining([
        "updater:allow-check",
        "updater:allow-download",
        "updater:allow-install",
        "updater:allow-download-and-install",
      ])
    );
    // tauri-build rejects a permission whose plugin is absent on the target,
    // so the macOS-wide desktop capability must not carry it.
    expect(read("src-tauri/capabilities/desktop.json")).not.toContain("updater");
    expect(read("src-tauri/capabilities/android.json")).not.toContain("updater");
  });

  it("compiles the endpoint override out of release builds", () => {
    const source = read("src-tauri/src/updater.rs");
    expect(source).toMatch(/#\[cfg\(debug_assertions\)\]\s*pub fn apply_endpoint_override/);
    expect(read("src-tauri/src/lib.rs")).toMatch(
      /#\[cfg\(all\(target_os = "linux", debug_assertions\)\)\]\s*updater::apply_endpoint_override/
    );
    expect(read("src-tauri/src/lib.rs").match(/MAIBUK_UPDATER_ENDPOINT/g)).toHaveLength(1);
  });
});
