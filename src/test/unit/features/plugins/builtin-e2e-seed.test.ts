import { afterEach, describe, expect, it, vi } from "vitest";

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

/**
 * A fresh instance of the Built-in module, as a page load gets: the E2E seed is
 * read once per instance, so every test that seeds storage loads its own.
 */
async function freshBuiltIns() {
  vi.resetModules();
  return import("@/features/plugins/builtin");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("Built-in source E2E seed", () => {
  it("ignores a seeded list in a shipped build, even on an automated page", async () => {
    vi.stubEnv("VITE_E2E_BUILTIN_SEED", undefined);
    vi.stubGlobal("navigator", { ...navigator, webdriver: true });
    const { E2E_BUILTIN_PLUGINS_STORAGE_KEY, createBuiltInPluginSource } = await freshBuiltIns();
    localStorage.setItem(E2E_BUILTIN_PLUGINS_STORAGE_KEY, seed);

    await expect(createBuiltInPluginSource().list()).resolves.toEqual([]);
  });

  it("lists the seeded Built-ins in the E2E lane's build, without shipped bytes", async () => {
    vi.stubEnv("VITE_E2E_BUILTIN_SEED", "1");
    const { E2E_BUILTIN_PLUGINS_STORAGE_KEY, createBuiltInPluginSource } = await freshBuiltIns();
    localStorage.setItem(E2E_BUILTIN_PLUGINS_STORAGE_KEY, seed);

    const listed = await createBuiltInPluginSource().list();

    expect(listed.map((entry) => [entry.id, entry.hash, entry.files])).toEqual([
      ["third-party", "h1:seeded", []],
    ]);
  });

  it("decodes the shipped bytes a Reinstall writes when the seed carries files", async () => {
    vi.stubEnv("VITE_E2E_BUILTIN_SEED", "1");
    const { E2E_BUILTIN_PLUGINS_STORAGE_KEY, createBuiltInPluginSource } = await freshBuiltIns();
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

describe("Built-in source E2E seed, decoded once per page load", () => {
  // The app asks the source for the Built-ins on every launch step (the sync,
  // the scan, the Settings list). The shipped source reads its index once per
  // session; the seam must not re-decode the same multi-megabyte seed on every
  // call, or each start pays for it again (issue #653, gate 1).
  const seedWithFiles = JSON.stringify({
    plugins: [
      {
        id: "built-in",
        hash: "h1:seeded",
        manifest: { id: "built-in", permissions: { required: [], optional: [] } },
        files: [{ path: "index.js", base64: btoa("export const a = 1;") }],
      },
    ],
  });

  it("decodes the seeded bytes once across repeated list() calls", async () => {
    vi.stubEnv("VITE_E2E_BUILTIN_SEED", "1");
    const { E2E_BUILTIN_PLUGINS_STORAGE_KEY, createBuiltInPluginSource } = await freshBuiltIns();
    localStorage.setItem(E2E_BUILTIN_PLUGINS_STORAGE_KEY, seedWithFiles);
    const decode = vi.spyOn(globalThis, "atob");

    const source = createBuiltInPluginSource();
    const first = await source.list();
    const second = await createBuiltInPluginSource().list();

    expect(decode).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it("lists the seed a fresh page load finds, not the one an earlier load decoded", async () => {
    vi.stubEnv("VITE_E2E_BUILTIN_SEED", "1");
    const first = await freshBuiltIns();
    localStorage.setItem(first.E2E_BUILTIN_PLUGINS_STORAGE_KEY, seedWithFiles);
    await first.createBuiltInPluginSource().list();

    // The spec rewrites the seed before the app boots; that load is a new instance.
    localStorage.setItem(first.E2E_BUILTIN_PLUGINS_STORAGE_KEY, seed);
    const second = await freshBuiltIns();

    await expect(second.createBuiltInPluginSource().list()).resolves.toMatchObject([
      { id: "third-party", hash: "h1:seeded" },
    ]);
  });
});

// The E2E seeder cannot import `builtin.ts` (its platform import reads
// `import.meta.env`, which the Playwright runner lacks), so it repeats the key.
describe("E2E Built-in seed key", () => {
  it("matches the key the E2E seeder writes", async () => {
    const { E2E_BUILTIN_PLUGINS_STORAGE_KEY } = await freshBuiltIns();
    const { readFile } = await import("node:fs/promises");
    const source = await readFile("e2e/support/storage.ts", "utf8");
    expect(source).toContain(
      `const E2E_BUILTIN_PLUGINS_STORAGE_KEY = "${E2E_BUILTIN_PLUGINS_STORAGE_KEY}";`
    );
  });
});
