// The Plugins bench's WebKitGTK lane (issue #448): the process and
// socket shell around `webkitgtk-plan.ts`.
//
// Playwright's WebKit cannot measure this lane (it has no OPFS, so Plugins
// cannot be seeded there), so the lane drives the **real Tauri Linux binary**:
// it builds the app once with `VITE_PLUGIN_BENCH=1` and
// `VITE_PLUGIN_BENCH_DRIVER=1`, then, per measurement, gives a fresh temporary
// HOME/XDG tree, seeds the Plugin Directory and the approval records the
// scenario needs, launches the app, waits for the in-app driver's `/done`, and
// kills it. Every launch is a fresh device, so the author's real Library is
// never touched.
//
// It reuses the conformance lane's build, launch, collector, and config
// override rather than copying them (issue #448). Any missing prerequisite or
// harness failure throws; the runner records it as `unmeasured` and exits 2.
//
// Not in CI: real app timing on a shared machine is noise.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { BENCH_SEED_FILE, BENCH_COLLECTOR_PATHS } from "@/features/plugins/bench/protocol";
import type { PluginsBenchSeed } from "@/features/plugins/bench/types";
import { hashPluginDirectory } from "@/features/plugins/directory-hash";
import type {
  PluginApproval,
  PluginFolderFile,
  PluginPermissionId,
} from "@/features/plugins/types";
import { BENCH_IDENTIFIER, benchConfigOverride } from "@/test/support/plugin-conformance/csp";
import { readFolderFiles } from "@/test/support/plugin-fixtures";
import type { PluginsBenchReport } from "../../scripts/plugins-bench-budget.mjs";
import { startHttpCollector } from "../conformance/collector";
import {
  assertLinuxPrerequisites,
  buildLinuxApp,
  launchLinuxApp,
  linuxBinaryFor,
} from "../conformance/linux";
import type { RunDir } from "../conformance/types";
import {
  clonePluginId,
  clonePluginManifest,
  clonePluginSeeds,
  type PluginSeed,
} from "../support/storage";
import { type MeasurementFile, type PluginsBenchOptions, assembleReport } from "./report";
import {
  type LaunchCapture,
  type WebkitScenario,
  benchScenarios,
  createCapture,
  isStaleBenchInstance,
  echoTextFor,
  launchPlan,
  measurementFile,
  pluginFoldersFor,
} from "./webkitgtk-plan";

/** The built fixture Plugins (`e2e/support/plugin-fixtures-build.ts`). */
const PLUGIN_BUILD_DIR = "e2e/.output/plugins";
/** Where the lane keeps its logs, per-launch temp homes, and generated config. */
const RUN_ROOT = "e2e/.output/bench-webkitgtk";
/** Poll interval while waiting for the driver's `/done`. */
const POLL_MS = 200;
/** How long one launch may take before it is a harness failure. */
const LAUNCH_TIMEOUT_MS = 180_000;

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

/** One seeded Plugin Directory folder, ready to write to disk. */
interface SeedFolder {
  id: string;
  files: PluginFolderFile[];
  pinnedHash: string;
  granted: readonly PluginPermissionId[];
}

/** Adds the desktop host platform to a manifest, so its surfaces register on Tauri. */
function withDesktopPlatform(manifestText: string): string {
  const manifest = JSON.parse(manifestText) as { platforms?: string[] };
  manifest.platforms = [...new Set([...(manifest.platforms ?? []), "desktop"])];
  return JSON.stringify(manifest, null, 2);
}

/**
 * The bytes of the fixture `from`, with a clone's rewritten manifest applied and
 * the desktop host platform added. The E2E fixtures declare
 * `platforms: ["web"]` (they are seeded into a Chromium OPFS), and the desktop
 * host filters a Plugin's Commands, pages, and sidebar entries by platform
 * (`contributions.ts`), so on the WebKitGTK lane nothing would register without
 * this. Each folder's pinned hash is computed over exactly these bytes.
 */
function folderFilesFor(root: string, from: string, cloneIndex: number | null): PluginFolderFile[] {
  const dir = resolve(root, PLUGIN_BUILD_DIR, from);
  if (!existsSync(dir)) {
    throw new Error(`the built fixture Plugin "${from}" is missing at ${dir}; run the E2E setup`);
  }
  const files = readFolderFiles(dir);
  const sourceManifest = files.find((file) => file.path === "manifest.json");
  if (sourceManifest === undefined) throw new Error(`fixture "${from}" has no manifest.json`);
  const sourceText = new TextDecoder().decode(sourceManifest.bytes);
  let manifestText: string;
  if (cloneIndex === null) {
    manifestText = withDesktopPlatform(sourceText);
  } else {
    const id = clonePluginId(from as never, cloneIndex);
    const name = (JSON.parse(sourceText) as { name: string }).name;
    manifestText = withDesktopPlatform(
      clonePluginManifest(sourceText, id, `${name} Clone ${cloneIndex}`)
    );
  }
  const rewritten = new TextEncoder().encode(manifestText);
  return files.map((file) =>
    file.path === "manifest.json" ? { path: file.path, bytes: rewritten } : file
  );
}

/**
 * Expands a scenario's folder plan into the seeded folders it writes. Clones
 * come from `clonePluginSeeds`' own id/manifest logic (`clonePluginId`,
 * `clonePluginManifest`), so the ids and rewritten manifests match the E2E
 * lane's; each folder's pinned hash is computed over the exact bytes written,
 * so it matches what Rust hashes on read.
 */
export async function seedFoldersFor(
  root: string,
  scenario: WebkitScenario
): Promise<SeedFolder[]> {
  const folders: SeedFolder[] = [];
  for (const plan of pluginFoldersFor(scenario)) {
    if (plan.clones > 0) {
      // Use `clonePluginSeeds` to validate the library is present and to keep
      // the clone count and ids in one place; the ids are re-derived identically.
      const seeds = clonePluginSeeds(plan.from as PluginSeed, plan.clones);
      if (seeds.size !== plan.clones) {
        throw new Error(`clonePluginSeeds produced ${seeds.size} of ${plan.clones} clones`);
      }
      for (let index = 1; index <= plan.clones; index += 1) {
        const files = folderFilesFor(root, plan.from, index);
        folders.push({
          id: clonePluginId(plan.from as PluginSeed, index),
          files,
          pinnedHash: await hashPluginDirectory(files),
          granted: plan.granted,
        });
      }
      continue;
    }
    const files = folderFilesFor(root, plan.from, null);
    folders.push({
      id: plan.from,
      files,
      pinnedHash: await hashPluginDirectory(files),
      granted: plan.granted,
    });
  }
  return folders;
}

/** Writes one folder's files under the Plugin Directory root. */
function writePluginFolder(pluginsRoot: string, folder: SeedFolder): void {
  for (const file of folder.files) {
    const path = resolve(pluginsRoot, folder.id, file.path);
    mkdirSync(resolve(path, ".."), { recursive: true });
    writeFileSync(path, file.bytes);
  }
}

/** The approval record a seeded folder needs: enabled, pinned to its own hash. */
function approvalFor(folder: SeedFolder): PluginApproval {
  return {
    pluginId: folder.id,
    pinnedHash: folder.pinnedHash,
    granted: [...folder.granted],
    enabled: true,
    approvedVersion: "",
    approvedPermissions: { required: [], optional: [] },
    approvedFiles: {},
  };
}

/** A fresh HOME/XDG tree and the directories the launch writes into. */
interface LaunchDirs {
  home: string;
  pluginsRoot: string;
  dataDir: string;
  configDir: string;
  runtimeDir: string;
}

function createLaunchDirs(base: string): LaunchDirs {
  const home = mkdtempSync(resolve(base, "home-"));
  const dataDir = resolve(home, "data", BENCH_IDENTIFIER);
  const configDir = resolve(home, "config", BENCH_IDENTIFIER);
  const runtimeDir = resolve(home, "runtime");
  const pluginsRoot = resolve(home, "Documents", "Maibuk", "Plugins");
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(configDir, { recursive: true });
  mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
  mkdirSync(pluginsRoot, { recursive: true });
  return { home, pluginsRoot, dataDir, configDir, runtimeDir };
}

/** The environment a bench launch runs with: every device path inside one temp HOME. */
function launchEnv(dirs: LaunchDirs): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: dirs.home,
    XDG_DATA_HOME: resolve(dirs.home, "data"),
    XDG_CONFIG_HOME: resolve(dirs.home, "config"),
    XDG_CACHE_HOME: resolve(dirs.home, "cache"),
    XDG_STATE_HOME: resolve(dirs.home, "state"),
    XDG_RUNTIME_DIR: dirs.runtimeDir,
  };
}

/** The page a Plugin's first declared surface opens, from its built manifest. */
function pageIdFor(root: string, pluginId: string): string {
  for (const dir of [
    resolve(root, PLUGIN_BUILD_DIR, pluginId),
    resolve(root, "plugins", pluginId),
  ]) {
    const manifestPath = resolve(dir, "manifest.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      contributes?: { pages?: { id: string }[] };
    };
    const page = manifest.contributes?.pages?.[0];
    if (page) return page.id;
  }
  throw new Error(`no manifest with a page for Plugin "${pluginId}"`);
}

/** The on-demand Plugin ids the shipped Built-ins declare (`plugins/builtins.json`). */
export function onDemandBuiltinIds(root: string): string[] {
  const path = resolve(root, "plugins/builtins.json");
  if (!existsSync(path)) return [];
  const list = JSON.parse(readFileSync(path, "utf8")) as { plugins?: unknown[] };
  const ids: string[] = [];
  for (const entry of list.plugins ?? []) {
    const id = typeof entry === "string" ? entry : (entry as { id?: string }).id;
    if (id === undefined) continue;
    const manifestPath = resolve(root, "plugins", id, "manifest.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { lifecycle?: string };
    if (manifest.lifecycle === "on-demand") ids.push(id);
  }
  return ids;
}

/** The `stamp` Shortcut chord `fixture-everything` declares, as the host reads it. */
function stampShortcut(root: string): string {
  const path = resolve(root, PLUGIN_BUILD_DIR, "fixture-everything", "manifest.json");
  const manifest = JSON.parse(readFileSync(path, "utf8")) as {
    contributes?: { commands?: { id: string; defaults?: string[][] }[] };
  };
  const chord = manifest.contributes?.commands?.find((command) => command.id === "stamp")
    ?.defaults?.[0]?.[0];
  if (chord === undefined) throw new Error("fixture-everything declares no default stamp chord");
  return chord;
}

/** The seed the driver runs for one scenario launch. */
function seedFor(
  scenario: WebkitScenario,
  folders: SeedFolder[],
  collectorUrl: string,
  samples: number,
  stamp: string,
  pageId: string | null
): PluginsBenchSeed {
  const base: PluginsBenchSeed = {
    mode: "launch",
    samples,
    collectorUrl,
    approvals: folders.map(approvalFor),
  };
  switch (scenario.kind) {
    case "launch":
      return base;
    case "startToReady":
      if (pageId === null) throw new Error("startToReady has no page id");
      return {
        ...base,
        mode: "startToReady",
        startToReady: { pluginId: scenario.id, pageId },
      };
    case "commandToEffect":
      return { ...base, mode: "commandToEffect", stampShortcut: stamp };
    case "remoteUiEcho":
      return { ...base, mode: "remoteUiEcho", echoText: echoTextFor(samples) };
    case "remoteUiBurst":
      return { ...base, mode: "remoteUiBurst", echoText: echoTextFor(samples) };
  }
}

function describeScenario(scenario: WebkitScenario): string {
  switch (scenario.kind) {
    case "launch":
      return `launch-${scenario.config}`;
    case "startToReady":
      return `startToReady-${scenario.id}`;
    default:
      return scenario.kind;
  }
}

/**
 * Builds and launches the app once per measurement, folds the driver's posted
 * samples into a `PluginsBenchReport` for the `webkit` engine, and returns it.
 * Throws on any missing prerequisite or harness failure.
 */
/**
 * Stops any bench launch a killed runner left behind (see
 * `isStaleBenchInstance`); without this the next launch exits at once.
 */
function stopStaleBenchInstances(benchRoot: string): void {
  for (const pid of readdirSync("/proc").filter((name) => /^\d+$/.test(name))) {
    let environ: string;
    try {
      environ = readFileSync(`/proc/${pid}/environ`, "utf8");
    } catch {
      continue; // another user's process, or it already exited
    }
    if (!isStaleBenchInstance(environ, benchRoot)) continue;
    console.warn(`[plugins-bench] stopping a stale bench launch (pid ${pid})`);
    try {
      process.kill(Number(pid), "SIGTERM");
    } catch {
      // it exited between the read and the kill
    }
  }
}

export async function measureWebKitGtk(
  root: string,
  options: PluginsBenchOptions,
  started: number
): Promise<PluginsBenchReport> {
  assertLinuxPrerequisites();
  stopStaleBenchInstances(resolve(root, RUN_ROOT));

  const release = process.env.PLUGINS_BENCH_PROFILE === "release";
  const runDir: RunDir = {
    dir: resolve(root, RUN_ROOT, String(started)),
    configPath: resolve(root, RUN_ROOT, String(started), "tauri.bench.json"),
  };
  mkdirSync(runDir.dir, { recursive: true });

  if (!options.reuseBuild) {
    buildLinuxApp({
      root,
      runDir,
      release,
      env: { VITE_PLUGIN_BENCH: "1", VITE_PLUGIN_BENCH_DRIVER: "1" },
      configOverride: benchConfigOverride,
    });
  }
  const binary = linuxBinaryFor(release);
  if (!existsSync(resolve(root, binary))) {
    throw new Error(`no Linux binary at ${binary}: build without --reuse-build`);
  }
  const binaryPath = resolve(root, binary);

  const capture = createCapture();
  const collector = await startHttpCollector({
    port: 0,
    handle: (request) => {
      // The browser's CORS preflight for the JSON POST is answered here, so the
      // actual measurement POST is not blocked.
      if (request.method === "OPTIONS") return { status: 204 };
      if (request.method === "POST" && request.path === BENCH_COLLECTOR_PATHS.measure) {
        const body = request.body as
          | { mode?: unknown; samples?: unknown; textLost?: unknown; error?: unknown }
          | undefined;
        if (typeof body?.error === "string") {
          console.warn(`[plugins-bench] driver ${String(body.mode)}: ${body.error}`);
        }
        if (typeof body?.mode === "string" && Array.isArray(body.samples)) {
          capture.measure(body.samples as number[], body.textLost === true);
        }
        return { status: 204 };
      }
      if (request.method === "POST" && request.path === BENCH_COLLECTOR_PATHS.done) {
        capture.markDone();
        return { status: 204 };
      }
      return { status: 404, body: { error: "not the bench contract" } };
    },
  });

  const homeBase = resolve(runDir.dir, "homes");
  mkdirSync(homeBase, { recursive: true });
  const stamp = stampShortcut(root);
  const scenarios = benchScenarios(onDemandBuiltinIds(root));
  const files: MeasurementFile[] = [];
  const startToReady: Record<string, number[]> = {};

  try {
    let launchCounter = 0;
    for (const scenario of scenarios) {
      const folders = await seedFoldersFor(root, scenario);
      const pageId = scenario.kind === "startToReady" ? pageIdFor(root, scenario.id) : null;
      const { launches, warmups } = launchPlan(scenario, options.samples);
      const collected: number[] = [];
      for (let index = 0; index < launches; index += 1) {
        launchCounter += 1;
        const samples = await runLaunch({
          root,
          scenario,
          folders,
          collectorUrl: collector.url,
          samples: options.samples,
          stamp,
          pageId,
          runDir,
          homeBase,
          binary: binaryPath,
          capture,
          logName: `${String(launchCounter).padStart(3, "0")}-${describeScenario(scenario)}.log`,
        });
        if (index >= warmups) collected.push(...samples);
      }
      const name = measurementFile(scenario);
      if (scenario.kind === "startToReady") {
        startToReady[scenario.id] = collected;
      } else if (scenario.kind === "remoteUiEcho" || scenario.kind === "remoteUiBurst") {
        // An echo/burst file carries the samples and whether the full typed text
        // was lost; the budget check turns a lost text into a miss (exit 1).
        files.push({
          name,
          text: JSON.stringify({ samples: collected, textLost: capture.textLost() }),
        });
      } else {
        files.push({ name, text: JSON.stringify(collected) });
      }
    }
  } finally {
    await collector.close();
    rmSync(homeBase, { recursive: true, force: true });
  }

  files.push({ name: "startToReady", text: JSON.stringify(startToReady) });

  const report = assembleReport("webkitgtk", files);
  return {
    ...report,
    build: release ? "release" : "debug",
    note: "WebKitGTK samples use synthetic events: the Shortcut and keystrokes are dispatched in-app (no Playwright).",
  };
}

async function runLaunch(input: {
  root: string;
  scenario: WebkitScenario;
  folders: SeedFolder[];
  collectorUrl: string;
  samples: number;
  stamp: string;
  pageId: string | null;
  runDir: RunDir;
  homeBase: string;
  binary: string;
  capture: LaunchCapture;
  logName: string;
}): Promise<number[]> {
  const dirs = createLaunchDirs(input.homeBase);
  for (const folder of input.folders) writePluginFolder(dirs.pluginsRoot, folder);
  const seed = seedFor(
    input.scenario,
    input.folders,
    input.collectorUrl,
    input.samples,
    input.stamp,
    input.pageId
  );
  const seedText = JSON.stringify(seed);
  // The driver reads the seed from the app config dir first and the app data
  // dir second (the product's `fs` scope only permits one of them); write both
  // so the seed is there whichever the capability allows.
  writeFileSync(resolve(dirs.dataDir, BENCH_SEED_FILE), seedText);
  writeFileSync(resolve(dirs.configDir, BENCH_SEED_FILE), seedText);

  input.capture.reset();
  const app = await launchLinuxApp({
    root: input.root,
    runDir: input.runDir,
    binary: input.binary,
    env: launchEnv(dirs),
    logName: input.logName,
  });
  try {
    const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
    for (;;) {
      if (input.capture.done()) break;
      if (!(await app.isAlive())) {
        throw new Error(`the app died before /done (${describeScenario(input.scenario)})`);
      }
      if (Date.now() >= deadline) {
        throw new Error(`no /done within ${LAUNCH_TIMEOUT_MS / 1000}s`);
      }
      await sleep(POLL_MS);
    }
  } finally {
    await app.stop();
    rmSync(dirs.home, { recursive: true, force: true });
  }
  return input.capture.samples();
}
