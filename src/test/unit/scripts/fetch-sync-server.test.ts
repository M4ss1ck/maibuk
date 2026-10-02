import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MAIBUK_SYNC_COMMIT,
  MIGRATIONS,
  POCKETBASE_ASSETS,
  POCKETBASE_VERSION,
  pocketbaseAsset,
  sha256,
  syncServerPaths,
  verifyDigest,
} from "../../../../scripts/fetch-sync-server.mjs";
import { RUNS_DIR, sweepStaleRuns } from "../../../../e2e/sync-server.mjs";

describe("fetch-sync-server pins", () => {
  it("pins PocketBase 0.25.0, the version the maibuk-sync Dockerfile deploys", () => {
    expect(POCKETBASE_VERSION).toBe("0.25.0");
    for (const asset of Object.values(POCKETBASE_ASSETS)) {
      expect(asset.file).toContain("_0.25.0_");
      expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("picks the release zip for a host", () => {
    expect(pocketbaseAsset("linux", "x64").file).toBe("pocketbase_0.25.0_linux_amd64.zip");
    expect(pocketbaseAsset("darwin", "arm64").url).toBe(
      "https://github.com/pocketbase/pocketbase/releases/download/v0.25.0/pocketbase_0.25.0_darwin_arm64.zip"
    );
  });

  it("names the supported hosts when a host has no build", () => {
    expect(() => pocketbaseAsset("freebsd", "x64")).toThrow(/freebsd-x64.*supported: linux-x64/);
  });

  it("pins every maibuk-sync migration, in order, at one commit", () => {
    expect(Object.keys(MIGRATIONS)).toEqual([
      "001_sync_items.js",
      "002_version_items.js",
      "003_metrics_events_rows.js",
      "004_metrics_tombstones_rows.js",
      "005_version_items_word_count_optional.js",
      "006_note_items.js",
      "007_objects.js",
      "008_drop_legacy_collections.js",
      "009_objects_meta_max.js",
    ]);
    expect(MAIBUK_SYNC_COMMIT).toMatch(/^[0-9a-f]{40}$/);
  });

  it("puts the binary and migrations under vendor/sync-server", () => {
    expect(syncServerPaths("/r", "linux").binary).toBe(
      "/r/vendor/sync-server/pocketbase-0.25.0/pocketbase"
    );
    expect(syncServerPaths("/r", "win32").binary).toMatch(/pocketbase\.exe$/);
    expect(syncServerPaths("/r", "linux").migrationsDir).toBe(
      `/r/vendor/sync-server/maibuk-sync-${MAIBUK_SYNC_COMMIT.slice(0, 12)}/pb_migrations`
    );
  });

  it("accepts the pinned digest and rejects any other", () => {
    const bytes = Buffer.from("abc");
    expect(() => verifyDigest("x", bytes, sha256(bytes))).not.toThrow();
    expect(() => verifyDigest("x", bytes, "0".repeat(64))).toThrow(
      /^x: sha256 [0-9a-f]{64}, pinned 0{64}$/
    );
  });
});

describe("sweepStaleRuns", () => {
  let root: string;

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function run(name: string, files: Record<string, string>): string {
    const dir = join(root, RUNS_DIR, name);
    mkdirSync(join(dir, "pb_data"), { recursive: true });
    for (const [file, content] of Object.entries(files)) writeFileSync(join(dir, file), content);
    return dir;
  }

  /** The pid of a process that has already exited. */
  function deadPid(): string {
    return String(spawnSync(process.execPath, ["-e", ""]).pid);
  }

  it("removes a run whose runner died", () => {
    root = mkdtempSync(join(tmpdir(), "sweep-"));
    const dir = run("run-dead", { "owner.pid": deadPid() });
    expect(sweepStaleRuns(root)).toBe(1);
    expect(existsSync(dir)).toBe(false);
  });

  it("keeps a run whose runner is alive", () => {
    root = mkdtempSync(join(tmpdir(), "sweep-"));
    const dir = run("run-live", { "owner.pid": String(process.ppid) });
    expect(sweepStaleRuns(root)).toBe(0);
    expect(existsSync(dir)).toBe(true);
  });

  it("never kills a recycled pid that is not PocketBase", () => {
    root = mkdtempSync(join(tmpdir(), "sweep-"));
    // This test process stands in for an unrelated process that reused the pid.
    const dir = run("run-recycled", {
      "owner.pid": deadPid(),
      "pocketbase.pid": String(process.pid),
    });
    expect(sweepStaleRuns(root)).toBe(1);
    expect(existsSync(dir)).toBe(false);
    expect(process.kill(process.pid, 0)).toBe(true);
  });

  it("finds nothing when no run was ever started", () => {
    root = mkdtempSync(join(tmpdir(), "sweep-"));
    expect(sweepStaleRuns(root)).toBe(0);
  });
});
