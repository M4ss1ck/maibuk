import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A seeded Built-in is pre-granted every permission it declares, so the seed
// must be unreachable outside the E2E lane's build (#442).
const seed = {
  version: 1,
  plugins: [
    {
      id: "third-party",
      hash: "h1:seeded",
      manifest: { id: "third-party", permissions: { required: [], optional: [] } },
    },
  ],
};

const encoder = new TextEncoder();

/**
 * A fresh instance of the Built-in module, as a page load gets: the E2E seed is
 * read once per instance, so every test that seeds storage loads its own.
 */
async function freshBuiltIns() {
  vi.resetModules();
  return import("@/features/plugins/builtin");
}

/** Writes `record` where the E2E seeder does, as `e2e/support/storage.ts` writes it. */
async function writeSeed(record: unknown): Promise<void> {
  const { E2E_BUILTIN_PLUGINS_DB, E2E_BUILTIN_PLUGINS_STORE, E2E_BUILTIN_PLUGINS_RECORD } =
    await import("@/features/plugins/builtin");
  await new Promise<void>((resolve, reject) => {
    const open = indexedDB.open(E2E_BUILTIN_PLUGINS_DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(E2E_BUILTIN_PLUGINS_STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction(E2E_BUILTIN_PLUGINS_STORE, "readwrite");
      tx.objectStore(E2E_BUILTIN_PLUGINS_STORE).put(record, E2E_BUILTIN_PLUGINS_RECORD);
      tx.oncomplete = () => {
        open.result.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
  });
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Built-in source E2E seed", () => {
  it("ignores a seeded list in a shipped build, even on an automated page", async () => {
    vi.stubEnv("VITE_E2E_BUILTIN_SEED", undefined);
    vi.stubGlobal("navigator", { ...navigator, webdriver: true });
    await writeSeed(seed);
    const { createBuiltInPluginSource } = await freshBuiltIns();

    await expect(createBuiltInPluginSource().list()).resolves.toEqual([]);
  });

  it("lists the seeded Built-ins in the E2E lane's build, without shipped bytes", async () => {
    vi.stubEnv("VITE_E2E_BUILTIN_SEED", "1");
    await writeSeed(seed);
    const { createBuiltInPluginSource } = await freshBuiltIns();

    const listed = await createBuiltInPluginSource().list();

    expect(listed.map((entry) => [entry.id, entry.hash, entry.files])).toEqual([
      ["third-party", "h1:seeded", []],
    ]);
  });

  it("lists none when no spec seeded a list", async () => {
    vi.stubEnv("VITE_E2E_BUILTIN_SEED", "1");
    const { createBuiltInPluginSource } = await freshBuiltIns();

    await expect(createBuiltInPluginSource().list()).resolves.toEqual([]);
  });

  it("gives back the shipped bytes a Reinstall writes when the seed carries files", async () => {
    vi.stubEnv("VITE_E2E_BUILTIN_SEED", "1");
    await writeSeed({
      version: 1,
      plugins: [
        {
          id: "built-in",
          hash: "h1:seeded",
          manifest: { id: "built-in", permissions: { required: [], optional: [] } },
          files: [
            { path: "manifest.json", bytes: encoder.encode('{"id":"built-in"}') },
            { path: "index.js", bytes: encoder.encode("export const a = 1;") },
            { path: "dropped.js", base64: btoa("an older seed shape") },
          ],
        },
      ],
    });
    const { createBuiltInPluginSource } = await freshBuiltIns();

    const listed = await createBuiltInPluginSource().list();

    expect(
      listed[0].files.map((file) => [file.path, new TextDecoder().decode(file.bytes)])
    ).toEqual([
      ["manifest.json", '{"id":"built-in"}'],
      ["index.js", "export const a = 1;"],
    ]);
  });

  // The seed carries every shipped byte, and Reader's are 3 MB: in
  // localStorage that was past WebKit's quota, which charges a string with any
  // non-Latin-1 character (the manifest's "Open file…") two bytes a character.
  it("lists a seed larger than any browser's localStorage quota", async () => {
    vi.stubEnv("VITE_E2E_BUILTIN_SEED", "1");
    const big = new Uint8Array(6 * 1024 * 1024).fill(7);
    await writeSeed({
      version: 1,
      plugins: [
        {
          id: "built-in",
          hash: "h1:seeded",
          manifest: { id: "built-in", name: "Open file…", permissions: { required: [], optional: [] } },
          files: [{ path: "index.js", bytes: big }],
        },
      ],
    });
    const { createBuiltInPluginSource } = await freshBuiltIns();

    const listed = await createBuiltInPluginSource().list();

    expect(listed[0].files[0].bytes.byteLength).toBe(big.byteLength);
  });
});

describe("Built-in source E2E seed, read once per page load", () => {
  // The app asks the source for the Built-ins on every launch step (the sync,
  // the scan, the Settings list). The shipped source reads its index once per
  // session; the seam must not re-read the same multi-megabyte seed on every
  // call, or each start pays for it again (issue #653, gate 1).
  const seedWithFiles = {
    version: 1,
    plugins: [
      {
        id: "built-in",
        hash: "h1:seeded",
        manifest: { id: "built-in", permissions: { required: [], optional: [] } },
        files: [{ path: "index.js", bytes: encoder.encode("export const a = 1;") }],
      },
    ],
  };

  it("reads the seed once across repeated list() calls", async () => {
    vi.stubEnv("VITE_E2E_BUILTIN_SEED", "1");
    await writeSeed(seedWithFiles);
    const { createBuiltInPluginSource } = await freshBuiltIns();
    const open = vi.spyOn(indexedDB, "open");

    const first = await createBuiltInPluginSource().list();
    const second = await createBuiltInPluginSource().list();

    expect(open).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it("lists the seed a fresh page load finds, not the one an earlier load read", async () => {
    vi.stubEnv("VITE_E2E_BUILTIN_SEED", "1");
    await writeSeed(seedWithFiles);
    const first = await freshBuiltIns();
    await first.createBuiltInPluginSource().list();

    // The spec rewrites the seed before the app boots; that load is a new instance.
    await writeSeed(seed);
    const second = await freshBuiltIns();

    await expect(second.createBuiltInPluginSource().list()).resolves.toMatchObject([
      { id: "third-party", hash: "h1:seeded" },
    ]);
  });
});

// The E2E seeder cannot import `builtin.ts` (its platform import reads
// `import.meta.env`, which the Playwright runner lacks), so it repeats the names.
describe("E2E Built-in seed location", () => {
  it("matches the database, store, and record the E2E seeder writes", async () => {
    const { E2E_BUILTIN_PLUGINS_DB, E2E_BUILTIN_PLUGINS_STORE, E2E_BUILTIN_PLUGINS_RECORD } =
      await freshBuiltIns();
    const { readFile } = await import("node:fs/promises");
    const source = await readFile("e2e/support/storage.ts", "utf8");
    expect(source).toContain(`const E2E_BUILTIN_PLUGINS_DB = "${E2E_BUILTIN_PLUGINS_DB}";`);
    expect(source).toContain(`const E2E_BUILTIN_PLUGINS_STORE = "${E2E_BUILTIN_PLUGINS_STORE}";`);
    expect(source).toContain(`const E2E_BUILTIN_PLUGINS_RECORD = "${E2E_BUILTIN_PLUGINS_RECORD}";`);
  });
});
