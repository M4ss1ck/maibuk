// @vitest-environment node
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createServer, loadConfigFromFile } from "vite";
import { describe, expect, it, vi } from "vitest";

const unrelatedFiles = [
  "e2e/.output/report/index.html",
  "e2e/.output/report/trace/index.html",
  "e2e/.output/report/trace/snapshot.html",
  "e2e/.output/report/trace/uiMode.html",
  "e2e/specs/editor.spec.ts",
  "docs/example.html",
  "scripts/example.html",
  "src-tauri/src/lib.rs",
  "coverage/index.html",
  ".bench/result.json",
  ".cache/example.html",
  ".vitest-reports/results.json",
];
const frontendFiles = ["index.html", "src/main.tsx", "src/index.css", "public/example.html"];

describe("Vite dev watcher", () => {
  it.each(["web", "tauri"])("ignores unrelated trees in %s mode", async (target) => {
    vi.stubEnv("VITE_BUILD_TARGET", target);
    const root = await mkdtemp(join(tmpdir(), "maibuk-vite-watch-"));
    let server: Awaited<ReturnType<typeof createServer>> | undefined;
    try {
      const loaded = await loadConfigFromFile(
        { command: "serve", mode: "development" },
        resolve("vite.config.ts")
      );
      expect(loaded).not.toBeNull();
      for (const file of [...unrelatedFiles, ...frontendFiles]) {
        const path = join(root, file);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, "initial");
      }
      // Use the real config's watcher with an isolated fixture and no app plugins.
      server = await createServer({
        configFile: false,
        root,
        logLevel: "silent",
        server: { watch: loaded!.config.server?.watch, hmr: false },
      });
      const changed: string[] = [];
      server.watcher.on("change", (path) => changed.push(path));
      const watcher = server.watcher;
      await vi.waitFor(() => {
        for (const file of frontendFiles) {
          const path = join(root, file);
          expect(watcher.getWatched()[dirname(path)]).toContain(file.split("/").pop());
        }
      });
      for (const file of [...unrelatedFiles, ...frontendFiles]) {
        await writeFile(join(root, file), "changed");
      }
      await vi.waitFor(() => {
        for (const file of frontendFiles) expect(changed).toContain(join(root, file));
      });
      // Allow late events to arrive before checking the negative side.
      await new Promise((done) => setTimeout(done, 150));
      for (const file of unrelatedFiles) expect(changed).not.toContain(join(root, file));
    } finally {
      await server?.close();
      await rm(root, { recursive: true, force: true });
      vi.unstubAllEnvs();
    }
  });
});
