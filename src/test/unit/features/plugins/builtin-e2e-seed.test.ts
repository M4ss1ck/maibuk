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
});
