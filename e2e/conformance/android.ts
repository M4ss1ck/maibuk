// The conformance lane's Android engine (#447, D5): build the debug APK with the
// test-only flag, install it, forward the collector's port, launch the app, and
// watch it with `pidof`. It reuses the frame-rate lane's device helpers
// (`connectDevice`, `claimTestInstall`, `PrerequisiteMissing`) so a conformance
// run never touches an author's Library.

import { execFile, execFileSync, spawn } from "node:child_process";
import { type Dirent, createWriteStream, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import {
  ANDROID_PACKAGE,
  type AndroidDevice,
  PrerequisiteMissing,
} from "../frames/android";
import { tauriAndroidTarget } from "@/test/support/plugin-conformance";
import { CONFORMANCE_COLLECTOR_PORT } from "./collector";
import type { RunningApp, RunDir } from "./types";

const run = promisify(execFile);

/** The main activity the launcher starts. */
const ANDROID_ACTIVITY = `${ANDROID_PACKAGE}/.MainActivity`;

/** The System WebView package the stack records the version of. */
const WEBVIEW_PACKAGE = "com.google.android.webview";

/** The debug APK output root `tauri android build --debug` writes under. */
const APK_OUTPUT = "src-tauri/gen/android/app/build/outputs/apk";

async function adb(serial: string | undefined, args: string[]): Promise<string> {
  const full = serial ? ["-s", serial, ...args] : args;
  try {
    const { stdout } = await run("adb", full, { maxBuffer: 64 * 1024 * 1024 });
    return stdout;
  } catch (error) {
    const e = error as NodeJS.ErrnoException & { stderr?: string };
    if (e.code === "ENOENT") throw new PrerequisiteMissing("adb not found on PATH");
    throw new PrerequisiteMissing(`adb ${full.join(" ")} failed: ${e.stderr?.trim() || e.message}`);
  }
}

/** The one connected adb device, or ANDROID_SERIAL; refuses otherwise. */
export async function assertOneAdbDevice(): Promise<string> {
  const listed = (await adb(undefined, ["devices"]))
    .split("\n")
    .slice(1)
    .filter((line) => line.endsWith("\tdevice"))
    .map((line) => line.split("\t")[0]);
  const serial = process.env.ANDROID_SERIAL ?? (listed.length === 1 ? listed[0] : undefined);
  if (!serial || !listed.includes(serial)) {
    throw new PrerequisiteMissing(
      `expected exactly one adb device (or ANDROID_SERIAL), found ${listed.length}`
    );
  }
  return serial;
}

/** The device's Tauri build target, from its primary ABI (null: build every target). */
export async function deviceAndroidTarget(serial: string): Promise<string | null> {
  return tauriAndroidTarget(await adb(serial, ["shell", "getprop", "ro.product.cpu.abi"]));
}

/** Builds the debug APK with `VITE_PLUGIN_CONFORMANCE=1`, for one target when known. */
export function buildAndroidApp(options: { root: string; target: string | null }): void {
  const target = options.target ? ["--target", options.target] : [];
  execFileSync("pnpm", ["tauri", "android", "build", "--debug", "--apk", "true", ...target], {
    cwd: options.root,
    stdio: "inherit",
    env: { ...process.env, VITE_PLUGIN_CONFORMANCE: "1" },
  });
}

/** The newest debug APK under the build outputs, or null when there is none. */
export function findDebugApk(root: string): string | null {
  const found: string[] = [];
  const stack = [resolve(root, APK_OUTPUT)];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) stack.push(path);
      else if (entry.name.endsWith(".apk") && path.split(/[\\/]/).includes("debug")) found.push(path);
    }
  }
  found.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return found[0] ?? null;
}

/** Installs the APK over the existing debug build, keeping its Library. */
export async function installAndroidApp(serial: string, apk: string): Promise<void> {
  await adb(serial, ["install", "-r", "-t", apk]);
}

/** The System WebView package version, from `dumpsys package`. */
export async function androidWebViewVersion(serial: string): Promise<string> {
  const dump = await adb(serial, ["shell", "dumpsys", "package", WEBVIEW_PACKAGE]);
  const match = dump.match(/versionName=(\S+)/);
  return match?.[1] ?? "unknown";
}

async function waitForPid(device: AndroidDevice): Promise<number> {
  for (let i = 0; i < 50; i++) {
    const pid = Number(
      (await device.shell(["pidof", ANDROID_PACKAGE]).catch(() => "")).trim().split(" ")[0]
    );
    if (pid > 0) return pid;
    await new Promise((done) => setTimeout(done, 200));
  }
  throw new PrerequisiteMissing(`${ANDROID_PACKAGE} did not start`);
}

/**
 * Forwards the collector's port, starts a logcat capture, launches the app, and
 * returns a handle whose `isAlive` is `pidof` on the device.
 */
export async function launchAndroidApp(options: {
  device: AndroidDevice;
  runDir: RunDir;
}): Promise<RunningApp> {
  const { device } = options;
  await adb(device.serial, [
    "reverse",
    `tcp:${CONFORMANCE_COLLECTOR_PORT}`,
    `tcp:${CONFORMANCE_COLLECTOR_PORT}`,
  ]);

  const log = createWriteStream(resolve(options.runDir.dir, "logcat-android.txt"));
  const logcat = spawn("adb", ["-s", device.serial, "logcat", "-v", "time"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  logcat.stdout?.pipe(log);
  logcat.stderr?.pipe(log);

  await device.shell(["am", "start", "-W", "-n", ANDROID_ACTIVITY]);
  await waitForPid(device);

  return {
    isAlive: async () =>
      (await device.shell(["pidof", ANDROID_PACKAGE]).catch(() => "")).trim() !== "",
    async stop() {
      await device.shell(["am", "force-stop", ANDROID_PACKAGE]).catch(() => "");
      logcat.kill("SIGTERM");
      log.end();
      await adb(device.serial, [
        "reverse",
        "--remove",
        `tcp:${CONFORMANCE_COLLECTOR_PORT}`,
      ]).catch(() => "");
    },
  };
}
