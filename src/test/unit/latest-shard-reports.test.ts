import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { latestShardReports } from "../../../scripts/latest-shard-reports.mjs";

const script = resolve(__dirname, "../../../scripts/latest-shard-reports.mjs");

let scratch: string | null = null;
afterEach(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  scratch = null;
});

/** One downloaded artifact folder holding a blob report with `content`. */
function artifact(dir: string, name: string, file: string, content: string) {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(join(dir, name, file), content);
}

describe("latestShardReports()", () => {
  // PR #546: "Re-run failed jobs" left a failed and a passing shard-2 report in
  // the run, and the merge read the failed one, so the coverage gate stayed red.
  it("keeps only the newest attempt of each shard", () => {
    expect(
      latestShardReports([
        "vitest-blob-1-attempt-1",
        "vitest-blob-2-attempt-2",
        "vitest-blob-2-attempt-1",
        "vitest-blob-3-attempt-1",
      ])
    ).toEqual(["vitest-blob-1-attempt-1", "vitest-blob-2-attempt-2", "vitest-blob-3-attempt-1"]);
  });

  it("compares attempts as numbers, not text", () => {
    expect(latestShardReports(["vitest-blob-1-attempt-9", "vitest-blob-1-attempt-10"])).toEqual([
      "vitest-blob-1-attempt-10",
    ]);
  });

  it("ignores folders that are not shard reports", () => {
    expect(latestShardReports(["vitest-blob-1-attempt-1", "vitest-blob-2", "other"])).toEqual([
      "vitest-blob-1-attempt-1",
    ]);
  });
});

describe("latest-shard-reports CLI", () => {
  it("copies the newest report of each shard into the merge folder", () => {
    scratch = mkdtempSync(join(tmpdir(), "shard-reports-"));
    const artifacts = join(scratch, "artifacts");
    const out = join(scratch, "reports");
    artifact(artifacts, "vitest-blob-1-attempt-1", "blob-1-3.json", "shard 1");
    artifact(artifacts, "vitest-blob-2-attempt-1", "blob-2-3.json", "failed");
    artifact(artifacts, "vitest-blob-2-attempt-2", "blob-2-3.json", "passed");

    const result = spawnSync(process.execPath, [script, artifacts, out], { encoding: "utf8" });

    expect(result.status).toBe(0);
    expect(readdirSync(out).sort()).toEqual(["blob-1-3.json", "blob-2-3.json"]);
    expect(readFileSync(join(out, "blob-2-3.json"), "utf8")).toBe("passed");
    expect(result.stdout).toContain("vitest-blob-2-attempt-2");
  });

  it("fails when no shard report was downloaded", () => {
    scratch = mkdtempSync(join(tmpdir(), "shard-reports-"));
    mkdirSync(join(scratch, "artifacts"));

    const result = spawnSync(
      process.execPath,
      [script, join(scratch, "artifacts"), join(scratch, "reports")],
      { encoding: "utf8" }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no shard reports");
  });
});
