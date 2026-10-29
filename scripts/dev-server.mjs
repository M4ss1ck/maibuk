// What the dev server watches and pre-bundles. Both lists are measured
// fixes for dev-loop pain, kept here so their guard test can read them without
// loading vite.config.ts.
//
// Watching. Vite watches its whole root by default, which
// here means `src-tauri/target` (200k+ files: the web lane died with ENOSPC on
// the inotify limit), the E2E output a Playwright run writes thousands of files
// into, and every agent or tool folder at the root. None of those is in the
// module graph, so watching them only costs watchers and change events.
//
// The rule is an allowlist so a new tool folder at the root is ignored without
// anyone remembering to add it: the dev server watches the root's own files
// (index.html, CHANGELOG*.md, package.json, .env, the Vite config) and the
// folders below. A folder the app starts importing from has to be added here;
// the dev-server guard test fails until it is.
//
// Pre-bundling. Vite's dependency scan crawls from index.html and never follows
// `new Worker(new URL(...))`, so a package only a Worker imports is found the
// first time that Worker starts. Vite then re-bundles and reloads the page
// mid-session ("optimized dependencies changed. reloading"; `nspell` did this
// the first time the editor started spellcheck). Scanning the Worker entries
// too finds those packages at startup.
//
// Imported by vite.config.ts and by its unit test; there is no CLI.
import { statSync } from "node:fs";
import { relative, sep } from "node:path";

/** Folders, relative to the repo root, whose files the app imports or serves in dev. */
export const WATCHED_DIRS = [
  "src",
  "public",
  // Moonshine runtime, aliased as `moonshine-wasm` (re-fetched by `pnpm fetch:dictation`).
  "vendor",
  // `startup-screen.mjs` and this file are Vite config dependencies; editing them restarts the server.
  "scripts",
  // `windows-frame-record.ts` imports `plugins-conformance.results.json` from here.
  "docs/research",
];

/**
 * Where the dependency scan starts: the page and every Worker entry the dev
 * server can start. The QuickJS runner (`quickjs/worker-entry.ts`) is left out:
 * it only exists on Android builds, and scanning it would pre-bundle its engine
 * for every other platform.
 */
export const DEP_SCAN_ENTRIES = [
  "index.html",
  "src/lib/platform/web/db-worker.ts",
  "src/lib/platform/web/dictation/worker.ts",
  "src/lib/platform/web/dictation/capture-worklet.ts",
  "src/lib/metrics/metrics.worker.ts",
  "src/lib/spellcheck/spellcheck.worker.ts",
  "src/lib/db/sql-export.worker.ts",
  "src/features/sync/sync-codec.worker.ts",
  "src/features/plugins/modules.worker.ts",
];

/**
 * Packages served as they ship instead of pre-bundled. `@sqlite.org/sqlite-wasm`
 * starts its OPFS proxy Worker from `new URL("sqlite3-opfs-async-proxy.js",
 * import.meta.url)`, a file the pre-bundle does not contain, so every page load
 * logged two missing-file warnings and two "Error initializing OPFS asyncer"
 * console errors. Its README asks Vite users to exclude it.
 */
export const DEP_EXCLUDE = ["@sqlite.org/sqlite-wasm"];

/**
 * A chokidar `ignored` matcher for the repo at `root`: true for every path the
 * dev server should not watch. Paths outside `root` are left to Vite.
 */
export function devWatchIgnored(root) {
  // Not cached: a root folder such as `coverage/` can appear while the server runs.
  const isDirectory = (path, stats) => {
    if (stats) return stats.isDirectory();
    try {
      return statSync(path).isDirectory();
    } catch {
      return false;
    }
  };
  return (path, stats) => {
    const rel = relative(root, path).split(sep).join("/");
    if (rel === "" || rel.startsWith("../") || rel === "..") return false;
    const watched = WATCHED_DIRS.some(
      (dir) => rel === dir || rel.startsWith(`${dir}/`) || dir.startsWith(`${rel}/`)
    );
    if (watched) return false;
    // A file at the root is watched; a folder at the root is not unless listed.
    return rel.includes("/") || isDirectory(path, stats);
  };
}
