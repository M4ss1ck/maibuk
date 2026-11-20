import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PREVIEW_RUNS_DIR,
  createRunDir,
  killRecordedPreview,
  playwrightEnv,
  sweepRunDirs,
  sweepStalePreviews,
} from "../../../../e2e/preview-server.mjs";

function probeFor({
  alive = () => false,
  runs = () => false,
}: {
  alive?: (pid: number) => boolean;
  runs?: (pid: number, pattern: RegExp) => boolean;
} = {}) {
  return { isAlive: vi.fn(alive), runs: vi.fn(runs), kill: vi.fn() };
}

describe("sweepRunDirs", () => {
  let root: string;
  let base: string;

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function run(name: string, files: Record<string, string>): string {
    const dir = join(base, name);
    mkdirSync(dir, { recursive: true });
    for (const [file, content] of Object.entries(files)) writeFileSync(join(dir, file), content);
    return dir;
  }

  function freshBase(): void {
    root = mkdtempSync(join(tmpdir(), "preview-sweep-"));
    base = join(root, PREVIEW_RUNS_DIR);
    mkdirSync(base, { recursive: true });
  }

  it("keeps a run whose runner is alive", () => {
    freshBase();
    const dir = run("run-live", { "owner.pid": "12345" });
    const probe = probeFor({ alive: () => true });
    const onStale = vi.fn();
    expect(sweepRunDirs(base, { onStale, probe })).toBe(0);
    expect(existsSync(dir)).toBe(true);
    expect(probe.kill).not.toHaveBeenCalled();
    expect(onStale).not.toHaveBeenCalled();
  });

  it("kills a preview that still runs vite preview", () => {
    freshBase();
    const dir = run("run-stale", { "owner.pid": "99991", "preview.pid": "4242" });
    const probe = probeFor({
      runs: (_pid: number, pattern: RegExp) => pattern.test("node /x/vite preview --port 1"),
    });
    expect(sweepRunDirs(base, { probe })).toBe(1);
    expect(probe.kill).toHaveBeenCalledTimes(1);
    expect(probe.kill).toHaveBeenCalledWith(-4242, "SIGKILL");
    expect(existsSync(dir)).toBe(false);
  });

  it("never kills a recycled preview pid", () => {
    freshBase();
    const dir = run("run-recycled", { "owner.pid": "99991", "preview.pid": "4242" });
    const probe = probeFor({ runs: () => false });
    expect(sweepRunDirs(base, { probe })).toBe(1);
    expect(probe.kill).not.toHaveBeenCalled();
    expect(existsSync(dir)).toBe(false);
  });

  it("removes a run with a dead preview without killing", () => {
    freshBase();
    const dir = run("run-dead", { "owner.pid": "99991", "preview.pid": "4242" });
    const probe = probeFor({ alive: () => false, runs: () => false });
    expect(sweepRunDirs(base, { probe })).toBe(1);
    expect(probe.kill).not.toHaveBeenCalled();
    expect(existsSync(dir)).toBe(false);
  });

  it("treats its own pid as a stale owner", () => {
    freshBase();
    const dir = run("run-self", { "owner.pid": String(process.pid) });
    const probe = probeFor({ alive: () => true });
    expect(sweepRunDirs(base, { probe })).toBe(1);
    expect(existsSync(dir)).toBe(false);
  });

  it("sweeps a run with no owner.pid", () => {
    freshBase();
    const dir = run("run-no-owner", { "preview.pid": "4242" });
    const probe = probeFor();
    expect(sweepRunDirs(base, { probe })).toBe(1);
    expect(existsSync(dir)).toBe(false);
  });

  it("reports each stale dir to onStale, never live ones", () => {
    freshBase();
    const live = run("run-live", { "owner.pid": "12345" });
    const stale = run("run-stale", { "owner.pid": "99991" });
    const probe = probeFor({ alive: (pid: number) => pid === 12345 });
    const onStale = vi.fn();
    expect(sweepRunDirs(base, { onStale, probe })).toBe(1);
    expect(onStale).toHaveBeenCalledTimes(1);
    expect(onStale).toHaveBeenCalledWith(stale, probe);
    expect(existsSync(live)).toBe(true);
    expect(existsSync(stale)).toBe(false);
  });

  it("returns 0 without a base dir and ignores plain files", () => {
    root = mkdtempSync(join(tmpdir(), "preview-sweep-"));
    expect(sweepRunDirs(join(root, "nope"), { probe: probeFor() })).toBe(0);
    base = join(root, PREVIEW_RUNS_DIR);
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, "file"), "x");
    const dir = run("run-stale", { "owner.pid": "99991" });
    expect(sweepRunDirs(base, { probe: probeFor() })).toBe(1);
    expect(existsSync(join(base, "file"))).toBe(true);
    expect(existsSync(dir)).toBe(false);
  });
});

describe("sweepStalePreviews and createRunDir", () => {
  let root: string;

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("sweeps preview runs under the root", () => {
    root = mkdtempSync(join(tmpdir(), "preview-sweep-"));
    const dir = join(root, PREVIEW_RUNS_DIR, "run-old");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "owner.pid"), "99991");
    expect(sweepStalePreviews(root, probeFor())).toBe(1);
    expect(existsSync(dir)).toBe(false);
  });

  it("writes owner.pid with the runner pid", () => {
    root = mkdtempSync(join(tmpdir(), "preview-sweep-"));
    const dir = createRunDir(root, PREVIEW_RUNS_DIR);
    expect(dir).toBe(join(root, PREVIEW_RUNS_DIR, `run-${process.pid}`));
    expect(readFileSync(join(dir, "owner.pid"), "utf8")).toBe(String(process.pid));
    expect(readdirSync(join(root, PREVIEW_RUNS_DIR, ".."))).toEqual(["preview"]);
  });

  it("kills the recorded preview so a runner stopped mid-start leaves none", () => {
    root = mkdtempSync(join(tmpdir(), "preview-sweep-"));
    const dir = createRunDir(root, PREVIEW_RUNS_DIR);
    writeFileSync(join(dir, "preview.pid"), "4242");
    const probe = probeFor({
      runs: (_pid: number, pattern: RegExp) => pattern.test("vite preview"),
    });
    killRecordedPreview(dir, probe);
    expect(probe.kill).toHaveBeenCalledWith(-4242, "SIGKILL");
  });

  it("leaves a recorded pid alone once it no longer runs vite preview", () => {
    root = mkdtempSync(join(tmpdir(), "preview-sweep-"));
    const dir = createRunDir(root, PREVIEW_RUNS_DIR);
    writeFileSync(join(dir, "preview.pid"), "4242");
    const probe = probeFor();
    killRecordedPreview(dir, probe);
    killRecordedPreview(join(root, "missing"), probe);
    expect(probe.kill).not.toHaveBeenCalled();
  });
});

describe("playwrightEnv", () => {
  it("appends the flag to an existing NODE_OPTIONS", () => {
    expect(playwrightEnv({ NODE_OPTIONS: "--max-old-space-size=4096" }, {}).NODE_OPTIONS).toBe(
      "--max-old-space-size=4096 --no-experimental-webstorage"
    );
  });

  it("prefers extra's NODE_OPTIONS over base's", () => {
    const env = playwrightEnv({ NODE_OPTIONS: "--from-base" }, { NODE_OPTIONS: "--from-extra" });
    expect(env.NODE_OPTIONS).toBe("--from-extra --no-experimental-webstorage");
  });

  it("never duplicates the flag", () => {
    expect(playwrightEnv({ NODE_OPTIONS: "--no-experimental-webstorage" }, {}).NODE_OPTIONS).toBe(
      "--no-experimental-webstorage"
    );
    expect(
      playwrightEnv({}, { NODE_OPTIONS: "--trace-warnings --no-experimental-webstorage" })
        .NODE_OPTIONS
    ).toBe("--trace-warnings --no-experimental-webstorage");
  });

  it("is just the flag when no NODE_OPTIONS existed", () => {
    const env = playwrightEnv({ PATH: "/bin" }, { VITE_BUILD_TARGET: "web" });
    expect(env.NODE_OPTIONS).toBe("--no-experimental-webstorage");
    expect(env).toMatchObject({ PATH: "/bin", VITE_BUILD_TARGET: "web" });
  });

  it("makes localStorage throw in the Playwright process, so zustand skips persistence", () => {
    // #881: without the flag, Node 26 returns undefined here and zustand
    // persist crashes in E2E global setup. Older Node throws either way.
    const base = { ...process.env };
    delete base.NODE_OPTIONS;
    const child = spawnSync(
      process.execPath,
      [
        "-e",
        'try { localStorage.getItem("x"); process.exit(1) } catch (e) { process.exit(e instanceof ReferenceError ? 0 : 2) }',
      ],
      { env: playwrightEnv(base, {}) }
    );
    expect(child.status).toBe(0);
  });
});
