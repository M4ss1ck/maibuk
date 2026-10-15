/**
 * The Plugin network adapters (#453): on the web, `getPluginFetch()` serves the
 * browser's own `fetch`, subject to CORS; off the web build it serves the http
 * plugin's `fetch`, which runs in Rust. The plugin ignores the standard
 * `redirect` option the shared request sets, so the adapter adds
 * `maxRedirections: 0` to turn redirect following off in its Rust client, so a
 * granted host cannot forward the request or an injected secret elsewhere.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockFetch = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: mockFetch }));

const { tauriPluginFetch } = await import("@/lib/platform/tauri/network");
const { webPluginFetch } = await import("@/lib/platform/web/network");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("webPluginFetch (globalThis.fetch)", () => {
  it("calls the browser's fetch with the url and init unchanged", async () => {
    const fetch = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetch);

    const init: RequestInit = { method: "POST", headers: { "x-api-key": "v" }, body: "payload" };
    const response = await webPluginFetch("https://api.example.com/data", init);

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith("https://api.example.com/data", init);
  });

  it("lets a refused browser call reject, so the caller refuses the Plugin", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      })
    );

    await expect(webPluginFetch("https://api.example.com/data", {})).rejects.toThrow(
      "Failed to fetch"
    );
  });
});

describe("tauriPluginFetch (http plugin)", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("calls the http plugin's fetch with the init plus maxRedirections: 0", async () => {
    mockFetch.mockResolvedValue(new Response("desktop"));

    const init: RequestInit = { method: "GET", redirect: "error" };
    await tauriPluginFetch("https://api.example.com/data", init);

    expect(mockFetch).toHaveBeenCalledWith("https://api.example.com/data", {
      ...init,
      maxRedirections: 0,
    });
  });

  it("lets a refused plugin call reject", async () => {
    mockFetch.mockRejectedValue(new Error("network unavailable"));

    await expect(tauriPluginFetch("https://api.example.com/data", {})).rejects.toThrow(
      "network unavailable"
    );
  });
});

describe("getPluginFetch()", () => {
  async function loadPlatform(buildTarget: "web" | "tauri") {
    vi.stubEnv("VITE_BUILD_TARGET", buildTarget);
    vi.resetModules();
    return import("@/lib/platform");
  }

  it("serves the browser fetch on the web build, never the http plugin", async () => {
    const fetch = vi.fn(async () => new Response("web"));
    vi.stubGlobal("fetch", fetch);
    mockFetch.mockClear();

    const { getPluginFetch } = await loadPlatform("web");
    const pluginFetch = await getPluginFetch();
    const init: RequestInit = { method: "GET" };
    await pluginFetch("https://api.example.com/web", init);

    expect(fetch).toHaveBeenCalledWith("https://api.example.com/web", init);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("serves the http plugin fetch off the web build, refusing redirects", async () => {
    mockFetch.mockResolvedValue(new Response("desktop"));

    const { getPluginFetch } = await loadPlatform("tauri");
    const pluginFetch = await getPluginFetch();
    const init: RequestInit = { method: "GET", redirect: "error" };
    await pluginFetch("https://api.example.com/desk", init);

    expect(mockFetch).toHaveBeenCalledWith("https://api.example.com/desk", {
      ...init,
      maxRedirections: 0,
    });
  });
});
