#!/usr/bin/env node
// Picks the newest attempt of each test shard's blob report for the coverage
// merge. "Re-run failed jobs" uploads a second report for the re-run shard, and
// the merge must read that one, not the failed report it replaces (PR #546).
//
//   node scripts/latest-shard-reports.mjs <artifacts dir> <reports dir>
//
// Each artifact downloads into its own folder, vitest-blob-<shard>-attempt-<n>;
// the files of the newest folder per shard are copied into the reports dir.
import { cpSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const REPORT_FOLDER = /^vitest-blob-(\d+)-attempt-(\d+)$/;

export function latestShardReports(folders) {
  const newest = new Map();
  for (const folder of folders) {
    const match = REPORT_FOLDER.exec(folder);
    if (!match) continue;
    const [, shard, attempt] = match;
    const current = newest.get(shard);
    if (!current || Number(attempt) > current.attempt) {
      newest.set(shard, { folder, attempt: Number(attempt) });
    }
  }
  return [...newest.entries()]
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, { folder }]) => folder);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [artifactsDir, reportsDir] = process.argv.slice(2);
  const folders = latestShardReports(readdirSync(artifactsDir));
  if (folders.length === 0) {
    console.error(`${artifactsDir}: no shard reports to merge`);
    process.exit(1);
  }
  mkdirSync(reportsDir, { recursive: true });
  for (const folder of folders) {
    cpSync(join(artifactsDir, folder), reportsDir, { recursive: true });
    console.log(`merging ${folder}`);
  }
}
