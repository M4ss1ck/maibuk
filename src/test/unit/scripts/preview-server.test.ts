import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PREVIEW_RUNS_DIR,
  createRunDir,
  sweepRunDirs,
  sweepStalePreviews,
} from "../../../../e2e/preview-server.mjs";

function probeFor({ alive = () => false, runs = () => false } = {}) {
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
      runs: (_pid: number, pattern: RegExp) =>
        pattern.test("node /x/vite preview --port 1"),
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
  });
});
