// Node side of seeding: runs build-seeds.ts through Vite SSR (so `@/` aliases,
// `?url` imports and `import.meta.env` behave as in the app build) and writes
// one file per seed under e2e/.output/seeds/. Called once from global setup.

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { createServer, type ViteDevServer } from "vite";

export const REPO_ROOT = resolve(import.meta.dirname, "../../..");
export const SEED_DIR = resolve(REPO_ROOT, "e2e/.output/seeds");

// The write paths normalize HTML with DOMParser. jsdom supplies it, the same
// environment the Vitest suite runs these write paths under.
export function installDomGlobals(): void {
  if (typeof globalThis.DOMParser !== "undefined") return;
  const { window } = new JSDOM("<!doctype html><html><body></body></html>");
  const g = globalThis as Record<string, unknown>;
  for (const key of ["window", "document", "DOMParser", "Node", "HTMLElement", "Element"]) {
    g[key] = key === "window" ? window : (window as unknown as Record<string, unknown>)[key];
  }
}

/**
 * A Vite server that loads app modules for Node through SSR, so `@/` aliases,
 * `?url` imports and `import.meta.env` behave as in the app build. Also used
 * by the MCP Server Agent eval (`e2e/run-mcp-eval.ts`). The caller closes it.
 */
export function createSsrServer(): Promise<ViteDevServer> {
  return createServer({
    root: REPO_ROOT,
    configFile: resolve(REPO_ROOT, "vite.config.ts"),
    mode: "production",
    logLevel: "error",
    appType: "custom",
    server: { middlewareMode: true, hmr: false, ws: false },
    plugins: [
      {
        // No file watcher: seeds are built once, and a watcher needs inotify
        // instances, which a busy host runs out of (EMFILE). An inline
        // `watch: null` is dropped by mergeConfig, so clear the resolved one.
        name: "e2e-seeds-no-watch",
        configResolved(config) {
          (config.server as { watch: unknown }).watch = null;
        },
      },
    ],
    optimizeDeps: { noDiscovery: true, include: [] },
    // lucide-react has no `exports` map, so Node cannot resolve its
    // extensionless `lucide-react/dynamic` subpath; Vite's resolver can.
    ssr: { noExternal: ["lucide-react"] },
  });
}

export async function writeSeedFiles(): Promise<string[]> {
  installDomGlobals();
  const server = await createSsrServer();
  try {
    const mod = (await server.ssrLoadModule("/e2e/support/seed/build-seeds.ts")) as {
      buildAllSeeds: () => Promise<Record<string, Uint8Array>>;
    };
    const seeds = await mod.buildAllSeeds();
    await mkdir(SEED_DIR, { recursive: true });
    await Promise.all(
      Object.entries(seeds).map(([name, bytes]) =>
        writeFile(resolve(SEED_DIR, `${name}.sqlite`), bytes)
      )
    );
    return Object.keys(seeds);
  } finally {
    await server.close();
  }
}
