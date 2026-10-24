import type { Stats } from "node:fs";

export const WATCHED_DIRS: string[];
export const DEP_SCAN_ENTRIES: string[];
export const DEP_EXCLUDE: string[];
export function devWatchIgnored(root: string): (path: string, stats?: Stats) => boolean;
