// The desktop frame source's process side (issue #374). `pnpm bench:frames
// --source desktop` measures the real Tauri Linux release binary rendering in
// WebKitGTK, driven through tauri-driver and WebKitWebDriver. The binary is
// built under the bench identifier (`com.massick.maibuk.bench`), so its data
// never reaches the author's install. Each launch gets a fresh temporary HOME
// and XDG tree, so the author's Library is unreachable from the run, and the
// seed Library (or none, for "empty") is copied in before the app boots.
//
// WebDriver has no init scripts, so the frame probe is injected after each
// load (`webdriverFramePage`'s afterNavigate) rather than before the app boots.
// The probe guards against a second install, so a re-injected page keeps one.
// Nothing here knows about scenarios: scenarios.frames.ts picks the page, and
// the pure helpers (drivers, stamp, build decision) live in
// src/test/support/frames/desktop.ts.

import { createHash } from "node:crypto";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  DESKTOP_PREREQUISITES,
  type DesktopBuildStamp,
  desktopBuildDecision,
  findExecutable,
  missingPrerequisiteMessage,
} from "@/test/support/frames/desktop";
import { frameProbeScript } from "@/test/support/frames/probe";
import {
  createSession,
  deleteSession,
  webdriverFramePage,
  type WebDriverSession,
} from "@/test/support/frames/webdriver";
import { BENCH_IDENTIFIER, BENCH_PRODUCT_NAME } from "@/test/support/plugin-conformance/csp";
import type { RunDir } from "../conformance/types";
import { buildLinuxApp, linuxBinaryFor, webkitgtkVersion } from "../conformance/linux";
import { createLaunchDirs, launchEnv } from "../plugins-bench/webkitgtk";
import { SEED_DIR } from "../support/seed/seeds";
import { PrerequisiteMissing } from "./android";
import type { FramePage } from "./frame-page";

/** The stamp the frame lane writes beside the release binary it built. */
const STAMP_FILE = "src-tauri/target/release/maibuk.frames-stamp.json";
/** The origin the Tauri webview serves the app from under WebDriver. */
const APP_ORIGIN = "tauri://localhost";
/** The viewport the desktop scenarios measure at (matches the web source). */
const VIEWPORT = { width: 1280, height: 800 };
const DRIVER_READY_MS = 15_000;
const DRIVER_STOP_MS = 3_000;
/** The Tutorial state the web source dismisses with (scenarios: `tutorial: "dismissed"`). */
const TUTORIAL_DISMISSED = JSON.stringify({
  state: {
    progress: {
      dismissedAt: 1,
      completedAt: null,
      lastSection: null,
      lastStep: null,
      skippedAt: null,
      sections: {},
    },
  },
  version: 1,
});

interface DesktopDrivers {
  tauriDriver: string;
  webkitDriver: string;
}

/**
 * The two driver binaries, found the way the desktop source documents: the
 * env var, then PATH, then ~/.cargo/bin. Throws PrerequisiteMissing for the
 * first one that is absent.
 */
export function resolveDesktopDrivers(): DesktopDrivers {
  const found = new Map<string, string>();
  for (const prerequisite of DESKTOP_PREREQUISITES) {
    const path = findExecutable(prerequisite.name, {
      envVar: prerequisite.envVar,
      env: process.env,
      home: homedir(),
      isFile: (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
    });
    if (path === null) throw new PrerequisiteMissing(missingPrerequisiteMessage(prerequisite));
    found.set(prerequisite.name, path);
  }
  return {
    tauriDriver: found.get("tauri-driver")!,
    webkitDriver: found.get("WebKitWebDriver")!,
  };
}

/** What the release binary is built from; test and bench code stay out. */
const APP_SOURCES = [
  "src",
  ":(exclude)src/test",
  "src-tauri",
  ":(exclude)src-tauri/target",
  "public",
  "plugins",
  "index.html",
  "vite.config.ts",
  "package.json",
  "pnpm-lock.yaml",
];

/**
 * HEAD, plus a digest of uncommitted app-source changes when there are any,
 * so editing the app without committing invalidates a reused build. Edits to
 * the bench itself (e2e/, src/test/) do not.
 */
function appSourceVersion(root: string): string {
  const git = (args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const head = git(["rev-parse", "HEAD"]).trim();
  const diff = git(["diff", "HEAD", "--binary", "--", ...APP_SOURCES]);
  const untracked = git(["ls-files", "--others", "--exclude-standard", "--", ...APP_SOURCES])
    .split("\n")
    .filter(Boolean);
  if (!diff && untracked.length === 0) return head;
  const hash = createHash("sha256").update(diff);
  for (const file of untracked) hash.update(file).update(readFileSync(resolve(root, file)));
  return `${head}+dirty.${hash.digest("hex").slice(0, 12)}`;
}

function viteFlags(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env)
      .filter((entry): entry is [string, string] => entry[0].startsWith("VITE_") && entry[1] !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
  );
}

function readStamp(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

/**
 * Builds the release binary under the bench identifier unless the one on disk
 * still carries this lane's stamp for these app sources (and `reuse` is set). The
 * stamp records the binary's size and mtime, so another lane rebuilding the
 * same path (bench:plugins) makes the lane rebuild rather than measure it.
 */
export function ensureDesktopBuild(root: string, { reuse }: { reuse: boolean }): void {
  const binary = resolve(root, linuxBinaryFor(true));
  const stampPath = resolve(root, STAMP_FILE);
  const binaryExists = existsSync(binary);
  const stat = binaryExists ? statSync(binary) : null;
  const expected: DesktopBuildStamp = {
    lane: "frames",
    profile: "release",
    // The build inherits this process's environment, and Vite bakes every
    // VITE_* variable into the bundle: a shell with one exported is a
    // different build.
    frontendFlags: viteFlags(process.env),
    commit: appSourceVersion(root),
    binarySize: stat?.size ?? 0,
    binaryMtimeMs: stat?.mtimeMs ?? 0,
  };
  const decision = desktopBuildDecision(reuse, binaryExists, readStamp(stampPath), expected);
  if (!decision.build) {
    console.log("[frames] reusing the desktop build");
    return;
  }
  console.log(`[frames] building the desktop release binary (${decision.reason})`);

  const dir = resolve(root, "e2e/.output/frames-desktop", String(Date.now()));
  mkdirSync(dir, { recursive: true });
  const runDir: RunDir = { dir, configPath: resolve(dir, "tauri-config.json") };
  buildLinuxApp({
    root,
    runDir,
    env: {},
    release: true,
    configOverride: () => ({ identifier: BENCH_IDENTIFIER, productName: BENCH_PRODUCT_NAME }),
  });

  const built = statSync(binary, { throwIfNoEntry: false });
  if (!built) throw new Error(`the build left no binary at ${linuxBinaryFor(true)}`);
  const stamp: DesktopBuildStamp = {
    ...expected,
    binarySize: built.size,
    binaryMtimeMs: built.mtimeMs,
  };
  writeFileSync(stampPath, `${JSON.stringify(stamp, null, 2)}\n`);
}

export interface DesktopPage {
  page: FramePage;
  engineVersion: string;
  close(): Promise<void>;
}

async function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => done(port));
    });
  });
}

function tail(path: string): string {
  try {
    return readFileSync(path, "utf8").slice(-2000);
  } catch {
    return "(no driver log)";
  }
}

/** Polls tauri-driver's /status until it answers, or throws with its log tail. */
async function waitForDriver(
  base: string,
  driver: ChildProcess,
  exited: Promise<unknown>,
  logPath: string
): Promise<void> {
  const deadline = Date.now() + DRIVER_READY_MS;
  let exitedEarly = false;
  void exited.then(() => (exitedEarly = true));
  while (Date.now() < deadline) {
    if (exitedEarly) {
      throw new Error(`tauri-driver exited before it answered; log tail:\n${tail(logPath)}`);
    }
    try {
      const res = await fetch(`${base}/status`);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  await stopDriver(driver, exited);
  throw new Error(
    `tauri-driver did not answer on ${base} within 15 s; log tail:\n${tail(logPath)}`
  );
}

/** SIGTERM the driver's process group, then SIGKILL it after 3 s. */
async function stopDriver(driver: ChildProcess, exited: Promise<unknown>): Promise<void> {
  if (driver.pid === undefined || driver.exitCode !== null || driver.signalCode !== null) return;
  const signalGroup = (signal: NodeJS.Signals) => {
    try {
      process.kill(-driver.pid!, signal);
    } catch {
      // the group is already gone
    }
  };
  signalGroup("SIGTERM");
  const stopped = await Promise.race([
    exited.then(() => true),
    new Promise<boolean>((done) => setTimeout(() => done(false), DRIVER_STOP_MS)),
  ]);
  if (!stopped) signalGroup("SIGKILL");
  await exited;
}

/**
 * Starts tauri-driver on the release binary and returns a page the frame
 * drivers act on. Throws PrerequisiteMissing when a driver or the seed is
 * absent; any other failure stops what it started before it rethrows.
 */
export async function launchDesktop(root: string, seed: string): Promise<DesktopPage> {
  const drivers = resolveDesktopDrivers();
  const seedFile = resolve(SEED_DIR, `${seed}.sqlite`);
  if (seed !== "empty" && !existsSync(seedFile)) {
    throw new PrerequisiteMissing(`no seed file ${seedFile}: the seed build did not write it`);
  }

  const dirs = createLaunchDirs(tmpdir());
  let port: number;
  let nativePort: number;
  let log: number;
  const logPath = resolve(dirs.home, "tauri-driver.log");
  try {
    if (seed !== "empty") copyFileSync(seedFile, resolve(dirs.configDir, "maibuk.db"));
    port = await freePort();
    nativePort = await freePort();
    log = openSync(logPath, "w");
  } catch (error) {
    rmSync(dirs.home, { recursive: true, force: true });
    throw error;
  }
  const env = launchEnv(dirs);
  const driver = spawn(
    drivers.tauriDriver,
    [
      "--port",
      String(port),
      "--native-port",
      String(nativePort),
      "--native-driver",
      drivers.webkitDriver,
    ],
    { env, stdio: ["ignore", log, log], detached: true }
  );
  closeSync(log);
  const leftover = () => {
    // The worker is exiting with this launch still open (a failed close, an
    // interrupted run): stop the driver's process group and the app in it.
    // The group, even if tauri-driver itself already exited: the app may not have.
    if (driver.pid !== undefined) {
      try {
        process.kill(-driver.pid, "SIGKILL");
      } catch {
        // the group is already gone
      }
    }
    rmSync(dirs.home, { recursive: true, force: true });
  };
  process.once("exit", leftover);
  let spawnError: Error | null = null;
  const exited = new Promise<void>((done) => {
    driver.once("exit", () => done());
    driver.once("error", (error) => {
      spawnError = error;
      done();
    });
  });

  const base = `http://127.0.0.1:${port}`;
  let session: WebDriverSession | null = null;
  try {
    await waitForDriver(base, driver, exited, logPath);
    if (spawnError) throw spawnError;
    session = await createSession(base, {
      alwaysMatch: { "tauri:options": { application: resolve(root, linuxBinaryFor(true)) } },
    });
    await session.call("POST", "/window/rect", VIEWPORT);

    // The first load only sets the Tutorial state; the reload below boots the
    // app with it dismissed and the probe installed.
    const setup = webdriverFramePage(session, { origin: APP_ORIGIN });
    await setup.goto("/");
    await setup.evaluate(
      (value) => localStorage.setItem("maibuk-tutorial", value),
      TUTORIAL_DISMISSED
    );

    const probe = frameProbeScript();
    const page = webdriverFramePage(session, {
      origin: APP_ORIGIN,
      afterNavigate: async () => {
        await session!.call("POST", "/execute/sync", {
          script: `if (!window.__maibukFrameProbe) {\n${probe}\n}`,
          args: [],
        });
      },
    });
    await page.goto("/");

    const engineVersion = webkitgtkVersion() ?? "unknown";
    const current = session;
    return {
      page,
      engineVersion,
      close: async () => {
        await deleteSession(current).catch(() => undefined);
        await stopDriver(driver, exited);
        rmSync(dirs.home, { recursive: true, force: true });
        process.removeListener("exit", leftover);
      },
    };
  } catch (error) {
    if (session) await deleteSession(session).catch(() => undefined);
    await stopDriver(driver, exited);
    rmSync(dirs.home, { recursive: true, force: true });
    process.removeListener("exit", leftover);
    throw error;
  }
}
