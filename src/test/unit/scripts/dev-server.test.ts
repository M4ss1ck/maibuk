import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEP_SCAN_ENTRIES, devWatchIgnored } from "../../../../scripts/dev-server.mjs";

const root = process.cwd();
const ignored = devWatchIgnored(root);
const isIgnored = (rel: string) => ignored(resolve(root, rel));

describe("devWatchIgnored", () => {
  it("watches the app, its static files, and the root's own files", () => {
    for (const path of [
      "",
      "src",
      "src/main.tsx",
      "src/locales/en.json",
      "public",
      "vendor/moonshine/wasm/dist/index.js",
      "scripts/startup-screen.mjs",
      "docs",
      "docs/research/plugins-conformance.results.json",
      "index.html",
      "CHANGELOG.md",
      "package.json",
      "vite.config.ts",
    ]) {
      expect(isIgnored(path), path).toBe(false);
    }
  });

  it("ignores the native build, E2E, docs, Plugin sources, and tool folders", () => {
    // Root folders listed here are checked in, so they exist on every checkout.
    for (const path of [
      "src-tauri",
      "src-tauri/target/debug/build/out.js",
      "e2e",
      "e2e/shared.ts",
      "e2e/.output/web-dist/index.html",
      "docs/agents/design.md",
      "docs/plans",
      "dist/plugins/index.json",
      "plugins",
      ".github",
    ]) {
      expect(isIgnored(path), path).toBe(true);
    }
  });

  it("ignores a root folder it has never heard of, but not a root file", () => {
    const repo = mkdtempSync(join(tmpdir(), "dev-watch-"));
    try {
      writeFileSync(join(repo, "some-new-config.json"), "{}");
      const ignoredHere = devWatchIgnored(repo);
      // chokidar asks first without stats, so the folder check reads the disk.
      for (const folder of [".some-new-tool", "dist", "coverage"]) {
        mkdirSync(join(repo, folder));
        expect(ignoredHere(join(repo, folder)), folder).toBe(true);
      }
      expect(ignoredHere(join(repo, "some-new-config.json"))).toBe(false);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("ignores a root folder created after the matcher first saw its path", () => {
    const repo = mkdtempSync(join(tmpdir(), "dev-watch-"));
    try {
      const ignoredHere = devWatchIgnored(repo);
      ignoredHere(join(repo, "coverage"));
      mkdirSync(join(repo, "coverage"));
      expect(ignoredHere(join(repo, "coverage"))).toBe(true);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("leaves paths outside the repo to Vite", () => {
    expect(ignored(resolve(root, "../elsewhere/file.ts"))).toBe(false);
  });
});

/** Every non-test source file under src/. */
function appSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "test" ? [] : appSources(path);
    return /\.(ts|tsx|js|mjs)$/.test(entry.name) ? [path] : [];
  });
}

/**
 * Imports the guard skips: packages, which Vite never watches anyway, and the
 * conformance fixtures, which only a `VITE_PLUGIN_CONFORMANCE=1` build embeds
 * (see its fixture.ts); the dev server never loads them.
 */
const NOT_WATCHED = ["node_modules/", "e2e/.output/plugins/"];

const SPECIFIER =
  /(?:from\s+|import\(\s*|import\.meta\.glob\(\s*|new URL\(\s*)["']((?:\.\.?\/|\/)[^"'?*]*)/g;

describe("dev-server guard", () => {
  it("watches every file outside src/ that the app imports", () => {
    const unwatched: string[] = [];
    for (const file of appSources(resolve(root, "src"))) {
      for (const [, specifier] of readFileSync(file, "utf8").matchAll(SPECIFIER)) {
        const target = specifier.startsWith("/")
          ? resolve(root, specifier.slice(1))
          : resolve(dirname(file), specifier);
        const rel = relative(root, target).split("\\").join("/");
        if (rel.startsWith("src/") || NOT_WATCHED.some((prefix) => `${rel}/`.startsWith(prefix))) {
          continue;
        }
        if (isIgnored(rel)) unwatched.push(`${relative(root, file)} -> ${rel}`);
      }
    }
    expect(unwatched).toEqual([]);
  });

  it("finds the imports that reach outside src/", () => {
    // Proves the scan above is not vacuous: these are known to exist.
    const specifiers = appSources(resolve(root, "src")).flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(SPECIFIER)].map(([, specifier]) => specifier)
    );
    expect(specifiers).toContain("/CHANGELOG.md");
    expect(specifiers).toContain("../../../docs/research/plugins-conformance.results.json");
  });
});

/** Worker entries the dev server never starts: the QuickJS runner is Android-only. */
const ANDROID_ONLY_WORKERS = ["src/features/plugins/quickjs/worker-entry.ts"];

const WORKER_ENTRY =
  /new Worker\(\s*new URL\(\s*["']([^"']+)["']|["']([^"']+)\?worker(?:&url)?["']/g;

describe("DEP_SCAN_ENTRIES", () => {
  it("lists every Worker entry the app starts", () => {
    const workers = new Set<string>();
    for (const file of appSources(resolve(root, "src"))) {
      for (const [, url, query] of readFileSync(file, "utf8").matchAll(WORKER_ENTRY)) {
        const specifier = (url ?? query) as string;
        const target = specifier.startsWith("@/")
          ? resolve(root, "src", specifier.slice(2))
          : resolve(dirname(file), specifier);
        workers.add(relative(root, target).split("\\").join("/"));
      }
    }
    expect(workers.size).toBeGreaterThan(5);
    const missing = [...workers].filter(
      (worker) => !DEP_SCAN_ENTRIES.includes(worker) && !ANDROID_ONLY_WORKERS.includes(worker)
    );
    expect(missing).toEqual([]);
  });

  it("keeps the page as the first entry", () => {
    expect(DEP_SCAN_ENTRIES[0]).toBe("index.html");
  });

  it("lists only files that exist", () => {
    for (const entry of DEP_SCAN_ENTRIES) {
      expect(() => readFileSync(resolve(root, entry)), entry).not.toThrow();
    }
  });
});

describe("Tailwind source scope", () => {
  it("scans src/ only, so edits elsewhere do not rebuild the stylesheet", () => {
    const css = readFileSync(resolve(root, "src/index.css"), "utf8");
    expect(css).toMatch(/@import "tailwindcss" source\("\."\);/);
  });
});
