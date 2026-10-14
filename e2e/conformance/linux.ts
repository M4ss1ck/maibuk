// The conformance lane's Linux engine (#447, D5): build the app with the
// test-only flag and a conformance config, then launch the debug binary and
// track its pid. It refuses (exit 2, `PrerequisiteMissing`) when there is no
// display or no WebKitGTK to build and run against, and it measures the
// WebKitGTK version the stack records.

import { execFileSync, spawn } from "node:child_process";
import { createWriteStream, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { conformanceConfigOverride } from "@/test/support/plugin-conformance/csp";
import { PrerequisiteMissing } from "../frames/android";
import type { RunningApp, RunDir } from "./types";

/** The debug binary `pnpm tauri build --debug` leaves (Cargo package name). */
export const LINUX_BINARY = "src-tauri/target/debug/maibuk";

/** The release binary `pnpm tauri build` leaves. */
export const LINUX_RELEASE_BINARY = "src-tauri/target/release/maibuk";

/** The binary a build profile writes. */
export function linuxBinaryFor(release: boolean): string {
  return release ? LINUX_RELEASE_BINARY : LINUX_BINARY;
}

/** The config file `tauri build` merges, relative to the repo root. */
const TAURI_CONFIG = "src-tauri/tauri.conf.json";

/** The WebKitGTK packages `pkg-config` can name, newest first. */
const WEBKITGTK_PACKAGES = ["webkit2gtk-4.1", "webkit2gtk-4.0"] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

/** The WebKitGTK version `pkg-config` reports, or null when it is absent. */
export function webkitgtkVersion(): string | null {
  for (const pkg of WEBKITGTK_PACKAGES) {
    try {
      const version = execFileSync("pkg-config", ["--modversion", pkg], { encoding: "utf8" }).trim();
      if (version !== "") return version;
    } catch {
      // try the next package; a missing pkg-config fails every one.
    }
  }
  return null;
}

/**
 * Refuses when the Linux engine cannot be measured: no display (a WebKitGTK
 * window needs one) or no WebKitGTK for `pkg-config`. Returns the WebKitGTK
 * version the stack records.
 */
export function assertLinuxPrerequisites(): { webkitgtk: string } {
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    throw new PrerequisiteMissing(
      "no DISPLAY or WAYLAND_DISPLAY: a WebKitGTK window needs a display"
    );
  }
  const webkitgtk = webkitgtkVersion();
  if (webkitgtk === null) {
    throw new PrerequisiteMissing(
      "no WebKitGTK development package: install libwebkit2gtk-4.1-dev (pkg-config webkit2gtk-4.1)"
    );
  }
  return { webkitgtk };
}

/**
 * Builds the Linux binary with `VITE_PLUGIN_CONFORMANCE=1` and the conformance
 * config override (separate identifier, product name, CSP). Writes the override
 * to `runDir.configPath` first.
 *
 * The options are parameterised so the Plugins bench's WebKitGTK lane reuses
 * this exact build (issue #448) instead of copying it: `env` replaces
 * the frontend flags, `release` picks the profile (and the binary path), and
 * `configOverride` supplies the `--config` writer (the bench gets its own
 * identifier so it never touches the conformance install, let alone the
 * author's). The defaults are the conformance build.
 */
export function buildLinuxApp(options: {
  root: string;
  runDir: RunDir;
  /** The frontend build flags; defaults to the conformance flag. */
  env?: Record<string, string>;
  /** Build the release profile (default: debug). */
  release?: boolean;
  /** The `--config` override writer; defaults to the conformance override. */
  configOverride?: (base: unknown) => unknown;
}): void {
  const base = JSON.parse(readFileSync(resolve(options.root, TAURI_CONFIG), "utf8"));
  const override = options.configOverride ?? conformanceConfigOverride;
  writeFileSync(options.runDir.configPath, `${JSON.stringify(override(base), null, 2)}\n`);
  execFileSync(
    "pnpm",
    [
      "tauri",
      "build",
      ...(options.release ? [] : ["--debug"]),
      "--no-bundle",
      "--config",
      options.runDir.configPath,
    ],
    {
      cwd: options.root,
      stdio: "inherit",
      env: { ...process.env, ...(options.env ?? { VITE_PLUGIN_CONFORMANCE: "1" }) },
    }
  );
}

/**
 * Launches the binary, piping its output to the run directory, and returns a
 * handle whose `isAlive` is false once the process (and its group) is gone.
 * `binary` and `env` override the debug binary and the inherited environment:
 * the bench gives each launch its own temporary HOME/XDG dirs, so every launch
 * is a fresh device and the author's real Library is never touched.
 */
export async function launchLinuxApp(options: {
  root: string;
  runDir: RunDir;
  /** The binary to run; defaults to the debug binary. */
  binary?: string;
  /** The process environment; defaults to the inherited one. */
  env?: NodeJS.ProcessEnv;
  /** The log file name under the run dir; defaults to `linux.log`. */
  logName?: string;
}): Promise<RunningApp> {
  const binary = resolve(options.root, options.binary ?? LINUX_BINARY);
  if (!existsSync(binary)) {
    throw new PrerequisiteMissing(
      `no Linux binary at ${options.binary ?? LINUX_BINARY}: build without --skip-build`
    );
  }
  const log = createWriteStream(resolve(options.runDir.dir, options.logName ?? "linux.log"));
  const child = spawn(binary, [], {
    cwd: options.root,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: options.env ?? { ...process.env },
  });
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);
  let exited = false;
  child.once("exit", () => {
    exited = true;
    log.end();
  });

  const signal = (name: NodeJS.Signals) => {
    if (child.pid === undefined) return;
    try {
      process.kill(-child.pid, name);
    } catch {
      // The group is already gone.
    }
  };

  return {
    isAlive: async () => !exited,
    async stop() {
      if (exited) return;
      signal("SIGTERM");
      const deadline = Date.now() + 5_000;
      while (!exited && Date.now() < deadline) await sleep(100);
      if (!exited) {
        signal("SIGKILL");
        await sleep(200);
      }
      log.end();
    },
  };
}
