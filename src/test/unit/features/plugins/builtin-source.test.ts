// The production Built-in Plugin source (`src/features/plugins/builtin.ts`,
// issue #444): it fetches the shipped `plugins/index.json` the build writes,
// maps each entry to a Built-in, reads the shipped bytes on the web, and stays
// empty (never throwing) when anything is missing or malformed. The Tauri
// path lists no files: Rust copies from the bundled resources (ADR 0020).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const BASE = import.meta.env.BASE_URL;
const INDEX_URL = `${BASE}plugins/index.json`;

const MANIFEST = {
  manifestVersion: 1,
  id: "maibuk-echoes",
  name: "Echoes",
  description: "A Built-in Plugin.",
  author: "Maibuk",
  version: "1.0.0",
  apiVersion: "^0.1",
  entry: "index.js",
  platforms: ["web", "desktop", "android"],
  lifecycle: "on-demand",
  defaultLanguage: "en",
  permissions: { required: [], optional: [] },
};

interface IndexEntry {
  id: string;
  manifest: unknown;
  hash: string;
  files: string[];
}

function indexWith(plugins: IndexEntry[]) {
  return { plugins };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200 });
}

function bytesResponse(text: string): Response {
  return new Response(new TextEncoder().encode(text), { status: 200 });
}

/** A fetch that answers the URLs in `routes`, and 404s every other. */
function routedFetch(routes: Record<string, () => Response>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const route = routes[String(input)];
    return route === undefined ? new Response("missing", { status: 404 }) : route();
  });
}

async function loadCreateSource(buildTarget: "web" | "tauri") {
  vi.stubEnv("VITE_BUILD_TARGET", buildTarget);
  vi.stubEnv("VITE_E2E_BUILTIN_SEED", undefined);
  vi.resetModules();
  const { createBuiltInPluginSource } = await import("@/features/plugins/builtin");
  return createBuiltInPluginSource;
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("createBuiltInPluginSource() (production)", () => {
  it("returns an empty list when the index 404s", async () => {
    const createSource = await loadCreateSource("web");
    const fetchImpl = vi.fn(async () => new Response("missing", { status: 404 }));

    await expect(createSource(fetchImpl as unknown as typeof fetch).list()).resolves.toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it("returns an empty list when the index responds with HTML (dev-server fallback)", async () => {
    const createSource = await loadCreateSource("web");
    const fetchImpl = vi.fn(async () => new Response("<html></html>", { status: 200 }));

    await expect(createSource(fetchImpl as unknown as typeof fetch).list()).resolves.toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it("returns an empty list when the index JSON is malformed", async () => {
    const createSource = await loadCreateSource("web");
    const fetchImpl = vi.fn(async () => new Response("{ not json", { status: 200 }));

    await expect(createSource(fetchImpl as unknown as typeof fetch).list()).resolves.toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it("returns an empty list when the index has no plugin array", async () => {
    const createSource = await loadCreateSource("web");
    const fetchImpl = vi.fn(async () => jsonResponse({ nope: true }));

    await expect(createSource(fetchImpl as unknown as typeof fetch).list()).resolves.toEqual([]);
  });

  it("lists a Built-in with its shipped web bytes", async () => {
    const createSource = await loadCreateSource("web");
    const fetchImpl = routedFetch({
      [INDEX_URL]: () =>
        jsonResponse(
          indexWith([
            {
              id: "maibuk-echoes",
              manifest: MANIFEST,
              hash: "h1:shipped",
              files: ["manifest.json", "index.js"],
            },
          ])
        ),
      [`${BASE}plugins/maibuk-echoes/manifest.json`]: () => bytesResponse('{"id":"maibuk-echoes"}'),
      [`${BASE}plugins/maibuk-echoes/index.js`]: () => bytesResponse("export const a = 1;"),
    });

    const listed = await createSource(fetchImpl as unknown as typeof fetch).list();

    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      id: "maibuk-echoes",
      hash: "h1:shipped",
      manifest: { version: "1.0.0" },
    });
    expect(
      listed[0].files.map((file) => [file.path, new TextDecoder().decode(file.bytes)])
    ).toEqual([
      ["manifest.json", '{"id":"maibuk-echoes"}'],
      ["index.js", "export const a = 1;"],
    ]);
  });

  it("drops an entry whose shipped file cannot be read, keeping the rest", async () => {
    const createSource = await loadCreateSource("web");
    const fetchImpl = routedFetch({
      [INDEX_URL]: () =>
        jsonResponse(
          indexWith([
            { id: "maibuk-good", manifest: MANIFEST, hash: "h1:good", files: ["index.js"] },
            { id: "maibuk-bad", manifest: MANIFEST, hash: "h1:bad", files: ["index.js"] },
          ])
        ),
      [`${BASE}plugins/maibuk-good/index.js`]: () => bytesResponse("export const a = 1;"),
      // `maibuk-bad/index.js` is absent, so its fetch 404s.
    });

    const listed = await createSource(fetchImpl as unknown as typeof fetch).list();

    expect(listed.map((entry) => entry.id)).toEqual(["maibuk-good"]);
    expect(warn).toHaveBeenCalled();
  });

  it("drops an entry whose shape or manifest does not fit, keeping the rest", async () => {
    const createSource = await loadCreateSource("web");
    const fetchImpl = routedFetch({
      [INDEX_URL]: () =>
        jsonResponse(
          indexWith([
            // Missing `hash`.
            {
              id: "maibuk-shapeless",
              manifest: MANIFEST,
              files: ["index.js"],
            } as unknown as IndexEntry,
            // Invalid manifest (no name).
            { id: "maibuk-manifestless", manifest: { id: "x" }, hash: "h1:x", files: [] },
            { id: "maibuk-good", manifest: MANIFEST, hash: "h1:good", files: ["index.js"] },
          ])
        ),
      [`${BASE}plugins/maibuk-good/index.js`]: () => bytesResponse("export const a = 1;"),
    });

    const listed = await createSource(fetchImpl as unknown as typeof fetch).list();

    expect(listed.map((entry) => entry.id)).toEqual(["maibuk-good"]);
    expect(warn).toHaveBeenCalled();
  });

  it("fetches the index once for two list() calls", async () => {
    const createSource = await loadCreateSource("web");
    const fetchImpl = routedFetch({
      [INDEX_URL]: () => jsonResponse(indexWith([])),
    });
    const source = createSource(fetchImpl as unknown as typeof fetch);

    await source.list();
    await source.list();

    const indexCalls = fetchImpl.mock.calls.filter((call) => String(call[0]) === INDEX_URL);
    expect(indexCalls).toHaveLength(1);
  });

  it("returns files [] on Tauri without fetching any shipped file", async () => {
    const createSource = await loadCreateSource("tauri");
    const fetchImpl = routedFetch({
      [INDEX_URL]: () =>
        jsonResponse(
          indexWith([
            { id: "maibuk-echoes", manifest: MANIFEST, hash: "h1:shipped", files: ["index.js"] },
          ])
        ),
    });

    const listed = await createSource(fetchImpl as unknown as typeof fetch).list();

    expect(listed).toHaveLength(1);
    expect(listed[0].files).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0][0])).toBe(INDEX_URL);
  });
});
