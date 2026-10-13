import { afterEach, describe, expect, it, vi } from "vitest";
import {
  E2E_BUILTIN_PLUGINS_STORAGE_KEY,
  createBuiltInPluginSource,
} from "@/features/plugins/builtin";

// A seeded Built-in is pre-granted every permission it declares, so the seed
// must be unreachable outside the E2E lane's build (#442).
const seed = JSON.stringify({
  plugins: [
    {
      id: "third-party",
      hash: "h1:seeded",
      manifest: { id: "third-party", permissions: { required: [], optional: [] } },
    },
  ],
});

afterEach(() => {
  vi.unstubAllEnvs();
  localStorage.clear();
});

describe("Built-in source E2E seed", () => {
  it("ignores a seeded list in a shipped build, even on an automated page", async () => {
    vi.stubEnv("VITE_E2E_BUILTIN_SEED", undefined);
    vi.stubGlobal("navigator", { ...navigator, webdriver: true });
    localStorage.setItem(E2E_BUILTIN_PLUGINS_STORAGE_KEY, seed);

    await expect(createBuiltInPluginSource().list()).resolves.toEqual([]);
    vi.unstubAllGlobals();
  });

  it("lists the seeded Built-ins in the E2E lane's build, without shipped bytes", async () => {
    vi.stubEnv("VITE_E2E_BUILTIN_SEED", "1");
    localStorage.setItem(E2E_BUILTIN_PLUGINS_STORAGE_KEY, seed);

    const listed = await createBuiltInPluginSource().list();

    expect(listed.map((entry) => [entry.id, entry.hash, entry.files])).toEqual([
      ["third-party", "h1:seeded", []],
    ]);
  });

  it("decodes the shipped bytes a Reinstall writes when the seed carries files", async () => {
    vi.stubEnv("VITE_E2E_BUILTIN_SEED", "1");
    localStorage.setItem(
      E2E_BUILTIN_PLUGINS_STORAGE_KEY,
      JSON.stringify({
        plugins: [
          {
            id: "built-in",
            hash: "h1:seeded",
            manifest: { id: "built-in", permissions: { required: [], optional: [] } },
            files: [
              { path: "manifest.json", base64: btoa('{"id":"built-in"}') },
              { path: "index.js", base64: btoa("export const a = 1;") },
            ],
          },
        ],
      })
    );

    const listed = await createBuiltInPluginSource().list();

    expect(
      listed[0].files.map((file) => [file.path, new TextDecoder().decode(file.bytes)])
    ).toEqual([
      ["manifest.json", '{"id":"built-in"}'],
      ["index.js", "export const a = 1;"],
    ]);
  });
});

// The E2E seeder cannot import `builtin.ts` (its platform import reads
// `import.meta.env`, which the Playwright runner lacks), so it repeats the key.
describe("E2E Built-in seed key", () => {
  it("matches the key the E2E seeder writes", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile("e2e/support/storage.ts", "utf8");
    expect(source).toContain(
      `const E2E_BUILTIN_PLUGINS_STORAGE_KEY = "${E2E_BUILTIN_PLUGINS_STORAGE_KEY}";`
    );
  });
});
