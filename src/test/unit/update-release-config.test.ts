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

/** The job's tauri-action step, comment lines removed: only that step's env signs the build. */
function tauriActionStep(name: string): string {
  const steps = job(name).split(/\n(?= {6}- )/);
  const step = steps.find((text) => /\n\s+uses: tauri-apps\/tauri-action@/.test(text));
  expect(step, `${name} has no tauri-action step`).toBeDefined();
  return (step ?? "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
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
    const env = tauriActionStep(name).match(/\n {8}env:\n((?: {10}.*\n)+)/)?.[1] ?? "";
    for (const secret of ["TAURI_SIGNING_PRIVATE_KEY", "TAURI_SIGNING_PRIVATE_KEY_PASSWORD"]) {
      expect(env, `${name}'s tauri-action env lacks ${secret}`).toMatch(
        new RegExp(`^ {10}${secret}: \\$\\{\\{ secrets\\.${secret} \\}\\}$`, "m")
      );
    }
  });

  it("refuses a Release that still carries the development key", () => {
    expect(job("prepare")).toContain("DEV_KEY_ID=");
  });

  it("clears the bundle-type marker before the Arch package repackages the binary", () => {
    expect(read("scripts/build-arch-package.sh")).toMatch(/clear-bundle-type\.mjs.*\/maibuk/);
  });

  it("gives the Windows cross-build the NSIS header Tauri's installer includes", () => {
    // Ubuntu's nsis 3.08 lacks Win/RestartManager.nsh, which Tauri 2.12's
    // template includes; makensis aborts without it.
    const windows = job("build-windows");
    const install = windows.indexOf("Win/RestartManager.nsh");
    expect(install, "build-windows does not install RestartManager.nsh").toBeGreaterThan(-1);
    expect(install).toBeLessThan(windows.indexOf("uses: tauri-apps/tauri-action@"));
    expect(windows).toContain("nsis-3.13/nsis-3.13.zip");
    expect(windows).toMatch(/sha1sum -c/);
  });

  it("passes the Android bundle flags as plain switches (tauri-cli 2.12)", () => {
    const build = read("scripts/build-android-release.sh");
    expect(build).toMatch(/^pnpm tauri android build --apk --split-per-abi /m);
    expect(build).not.toMatch(/--(apk|aab) (true|false)/);
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

  it("installs Windows Updates in passive mode, so the installer shows its own progress", () => {
    expect(tauriConf.plugins.updater.windows).toEqual({ installMode: "passive" });
  });

  it("builds and registers the updater plugin on Linux and Windows", () => {
    const linuxAndWindows = 'cfg(any(target_os = "linux", target_os = "windows"))';
    const cargo = read("src-tauri/Cargo.toml");
    const section = cargo.slice(cargo.indexOf(`[target.'${linuxAndWindows}'.dependencies]`));
    expect(section.split(/\n\[/)[0]).toMatch(/^tauri-plugin-updater = /m);
    expect(read("src-tauri/src/lib.rs")).toContain(
      `#[${linuxAndWindows}]\n    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());`
    );
  });

  it("compiles the endpoint override out of release builds", () => {
    const source = read("src-tauri/src/updater.rs");
    expect(source).toMatch(/#\[cfg\(debug_assertions\)\]\s*pub fn apply_endpoint_override/);
    expect(read("src-tauri/src/lib.rs")).toMatch(
      /#\[cfg\(all\(any\(target_os = "linux", target_os = "windows"\), debug_assertions\)\)\]\s*updater::apply_endpoint_override/
    );
    expect(read("src-tauri/src/lib.rs").match(/MAIBUK_UPDATER_ENDPOINT/g)).toHaveLength(1);
  });
});
