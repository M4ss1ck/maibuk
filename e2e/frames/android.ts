// The Android device the frame-rate lane measures (issue #372), over adb. It
// follows the Android Dictation bench's conventions: exactly one device, or
// ANDROID_SERIAL; model and ABI recorded; a clear refusal when something is
// missing.
//
// The lane drives the installed app's WebView through Playwright's Android
// API, which needs the WebView debugging a debug build turns on, and swaps a seed
// Library into the app before each scenario. It never touches an author's
// Library: the first time it sees an install, the Library there must hold no
// Books, Chapters, Notes or Canvases (read with SQLite, WAL included); it then
// marks the install as the lane's own, and refuses any other.

import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { _android as android, type AndroidWebView, type Page } from "@playwright/test";

const run = promisify(execFile);

export const ANDROID_PACKAGE = "com.massick.maibuk";
const ACTIVITY = `${ANDROID_PACKAGE}/.MainActivity`;
const LIBRARY_FILE = "maibuk.db";
const MARKER_FILE = "maibuk-frame-bench";
const APP_ORIGIN = "http://tauri.localhost";
const AUTHOR_TABLES = ["books", "chapters", "notes", "canvases"];

/** A setup problem, never a perf result: the runner reports it and exits 2. */
export class PrerequisiteMissing extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrerequisiteMissing";
  }
}

export interface AndroidDevice {
  serial: string;
  model: string;
  abi: string;
  androidVersion: string;
  packageName: string;
  shell(args: string[]): Promise<string>;
}

async function adb(args: string[], serial?: string): Promise<string> {
  const full = serial ? ["-s", serial, ...args] : args;
  try {
    const { stdout } = await run("adb", full, { maxBuffer: 64 * 1024 * 1024 });
    return stdout;
  } catch (error) {
    const e = error as NodeJS.ErrnoException & { stderr?: string };
    if (e.code === "ENOENT") throw new PrerequisiteMissing("adb not found on PATH");
    throw new Error(`adb ${full.join(" ")} failed: ${e.stderr?.trim() || e.message}`);
  }
}

async function adbBuffer(args: string[], serial: string): Promise<Buffer> {
  const { stdout } = await run("adb", ["-s", serial, ...args], {
    encoding: "buffer",
    maxBuffer: 512 * 1024 * 1024,
  });
  return stdout;
}

/** The one device adb sees, or ANDROID_SERIAL; refuses otherwise. */
export async function connectDevice(): Promise<AndroidDevice> {
  const listed = (await adb(["devices"]))
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
  const shell = async (args: string[]) => adb(["shell", ...args], serial);
  // `pm path` exits 1 for a package that is not installed.
  if (!(await shell(["pm", "path", ANDROID_PACKAGE]).catch(() => "")).trim()) {
    throw new PrerequisiteMissing(`${ANDROID_PACKAGE} is not installed on ${serial}`);
  }
  try {
    await shell(["run-as", ANDROID_PACKAGE, "true"]);
  } catch {
    throw new PrerequisiteMissing(
      `${ANDROID_PACKAGE} on ${serial} is not debuggable: install a debug build (pnpm tauri android build --debug)`
    );
  }
  const prop = async (name: string) => (await shell(["getprop", name])).trim();
  return {
    serial,
    model: await prop("ro.product.model"),
    abi: await prop("ro.product.cpu.abi"),
    androidVersion: await prop("ro.build.version.release"),
    packageName: ANDROID_PACKAGE,
    shell,
  };
}

async function runAs(device: AndroidDevice, args: string[]): Promise<string> {
  return device.shell(["run-as", ANDROID_PACKAGE, ...args]);
}

async function findLibrary(device: AndroidDevice): Promise<string | null> {
  const found = (await runAs(device, ["find", ".", "-name", LIBRARY_FILE]))
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return found[0] ?? null;
}

async function exists(device: AndroidDevice, path: string): Promise<boolean> {
  // adb shell joins its arguments into one command line, so `sh -c '...'`
  // loses its quoting; ls's exit status needs none.
  return runAs(device, ["ls", path]).then(
    () => true,
    () => false
  );
}

/** Rows of author content in the device's Library, WAL included. */
async function authorRows(device: AndroidDevice, library: string): Promise<number> {
  const dir = await mkdtemp(join(tmpdir(), "maibuk-frames-"));
  try {
    const local = join(dir, LIBRARY_FILE);
    await writeFile(
      local,
      await adbBuffer(["exec-out", "run-as", ANDROID_PACKAGE, "cat", library], device.serial)
    );
    if (await exists(device, `${library}-wal`)) {
      await writeFile(
        `${local}-wal`,
        await adbBuffer(
          ["exec-out", "run-as", ANDROID_PACKAGE, "cat", `${library}-wal`],
          device.serial
        )
      );
    }
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(local);
    try {
      let rows = 0;
      for (const table of AUTHOR_TABLES) {
        const known = db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
          .get(table);
        if (!known) continue;
        rows += Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);
      }
      return rows;
    } finally {
      db.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function stopApp(device: AndroidDevice): Promise<void> {
  await device.shell(["am", "force-stop", ANDROID_PACKAGE]);
}

async function launchApp(device: AndroidDevice): Promise<number> {
  await device.shell(["am", "start", "-W", "-n", ACTIVITY]);
  for (let i = 0; i < 50; i++) {
    const pid = Number(
      (await device.shell(["pidof", ANDROID_PACKAGE]).catch(() => "")).trim().split(" ")[0]
    );
    if (pid > 0) return pid;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`${ANDROID_PACKAGE} did not start`);
}

/**
 * The install's Library path, once the install is known to hold no author
 * content. Marks the install so later runs may replace its Library.
 */
export async function claimTestInstall(device: AndroidDevice): Promise<string> {
  let library = await findLibrary(device);
  if (!library) {
    // A fresh install has no Library until its first launch creates one.
    await launchApp(device);
    await new Promise((resolve) => setTimeout(resolve, 5000));
    await stopApp(device);
    library = await findLibrary(device);
    if (!library)
      throw new PrerequisiteMissing(
        `no ${LIBRARY_FILE} in ${ANDROID_PACKAGE}'s data after a launch`
      );
  }
  const dir = library.slice(0, library.lastIndexOf("/"));
  const marker = `${dir}/${MARKER_FILE}`;
  if (await exists(device, marker)) return library;
  await stopApp(device);
  const rows = await authorRows(device, library);
  if (rows > 0) {
    throw new PrerequisiteMissing(
      `${ANDROID_PACKAGE} on ${device.serial} holds a Library with ${rows} Books, Chapters, Notes, or Canvases. ` +
        "The frame-rate lane never touches an author's Library: measure on a test install " +
        `(adb uninstall ${ANDROID_PACKAGE}, then install a debug build).`
    );
  }
  await runAs(device, ["touch", marker]);
  return library;
}

/** Replaces the test install's Library with a seed, with the app stopped. */
export async function installSeed(
  device: AndroidDevice,
  library: string,
  seedFile: string
): Promise<void> {
  await stopApp(device);
  const staged = `/data/local/tmp/${MARKER_FILE}.sqlite`;
  await adb(["push", seedFile, staged], device.serial);
  await runAs(device, ["rm", "-f", `${library}-wal`, `${library}-shm`]);
  await runAs(device, ["cp", staged, library]);
  await device.shell(["rm", "-f", staged]);
}

export interface AndroidSession {
  page: Page;
  origin: string;
  /** The WebView's Chrome version, from its user agent. */
  version: string;
  close(): Promise<void>;
}

/**
 * Starts the app and attaches Playwright to its WebView. Playwright's Android
 * API, not connectOverCDP: a WebView's DevTools endpoint has no browser
 * context management, which connectOverCDP needs.
 */
export async function attachWebView(device: AndroidDevice): Promise<AndroidSession> {
  await launchApp(device);
  const pw = (await android.devices()).find((candidate) => candidate.serial() === device.serial);
  if (!pw) throw new PrerequisiteMissing(`Playwright does not see ${device.serial}`);
  let webView: AndroidWebView;
  try {
    webView = await pw.webView({ pkg: ANDROID_PACKAGE }, { timeout: 20_000 });
  } catch {
    await pw.close();
    throw new PrerequisiteMissing(
      `no debuggable WebView in ${ANDROID_PACKAGE}: install a debug build (pnpm tauri android build --debug --apk true)`
    );
  }
  const page = await webView.page();
  const version = /Chrome\/([\d.]+)/.exec(await page.evaluate(() => navigator.userAgent))?.[1];
  return {
    page,
    origin: APP_ORIGIN,
    version: version ?? "unknown",
    async close() {
      await pw.close().catch(() => {});
      await stopApp(device);
    },
  };
}
