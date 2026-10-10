import { describe, expect, it, vi } from "vitest";
import { hashPluginDirectory } from "@/features/plugins/directory-hash";
import { startPlugin } from "@/features/plugins/runtime";
import {
  fakePluginFrame,
  pluginFolder,
} from "@/test/support/plugin-fixtures";
import type { PluginFolder } from "@/features/plugins/types";

async function start(
  folder: PluginFolder,
  overrides: Partial<Parameters<typeof startPlugin>[0]> = {}
) {
  return startPlugin({
    folder,
    pinnedHash: await hashPluginDirectory(folder.files),
    createFrame: () => fakePluginFrame(),
    ...overrides,
  });
}

describe("startPlugin()", () => {
  it("refuses a folder changed after pinning before any frame or Worker exists", async () => {
    const folder = pluginFolder({});
    const createFrame = vi.fn(() => fakePluginFrame());
    const result = await startPlugin({
      folder,
      pinnedHash: "h1:something-else",
      createFrame,
    });
    expect(result).toEqual({
      ok: false,
      refusal: {
        code: "hash-mismatch",
        expected: "h1:something-else",
        actual: await hashPluginDirectory(folder.files),
      },
    });
    expect(createFrame).not.toHaveBeenCalled();
  });

  it("starts a plugin that matches its pin, health-checks it, and is ready", async () => {
    const frame = fakePluginFrame();
    const result = await start(pluginFolder({}), { createFrame: () => frame });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(frame.entryUrl).toBe("blob:fake/0");
    expect(frame.sources.get("blob:fake/0")).toBe("export const a = 1;");
    expect(frame.requests).toEqual(["health.check"]);
    result.plugin.stop();
    expect(frame.stopped).toBe(true);
  });

  it("rewrites imports to the frame's module URLs, dependencies first", async () => {
    const folder = pluginFolder({
      "index.js": 'import { a } from "./lib/util.js";\nexport const b = a;',
      "lib/util.js": "export const a = 1;",
    });
    const frame = fakePluginFrame();
    const result = await start(folder, { createFrame: () => frame });
    expect(result.ok).toBe(true);
    expect([...frame.sources.keys()]).toEqual(["blob:fake/0", "blob:fake/1"]);
    expect(frame.sources.get("blob:fake/1")).toBe(
      'import { a } from "blob:fake/0";\nexport const b = a;'
    );
    expect(frame.entryUrl).toBe("blob:fake/1");
  });

  it("wires the real broker: a declared but ungranted call is refused", async () => {
    const folder = pluginFolder(
      { "index.js": "export {};" },
      { permissions: { required: ["library:read"], optional: [] } }
    );
    const handler = vi.fn(async () => []);
    const frame = fakePluginFrame();
    const result = await start(folder, {
      createFrame: () => frame,
      handlers: () => ({ "library.books.list": handler }),
      granted: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await expect(frame.call("library.books.list")).rejects.toMatchObject({
      code: "permission-denied",
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("runs a granted call through the broker's handler", async () => {
    const folder = pluginFolder(
      { "index.js": "export {};" },
      { permissions: { required: ["library:read"], optional: [] } }
    );
    const handler = vi.fn(async () => []);
    const frame = fakePluginFrame();
    const result = await start(folder, {
      createFrame: () => frame,
      handlers: () => ({ "library.books.list": handler }),
      granted: ["library:read"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await expect(frame.call("library.books.list")).resolves.toEqual([]);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("refuses a Library row while the Library is unavailable (the Tutorial)", async () => {
    const handler = vi.fn(async () => "value");
    const frame = fakePluginFrame();
    const result = await start(pluginFolder({}), {
      createFrame: () => frame,
      handlers: () => ({ "storage.get": handler }),
      isLibraryAvailable: () => false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await expect(frame.call("storage.get", { key: "a" })).rejects.toMatchObject({
      code: "library-unavailable",
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("refuses a folder without a manifest, before any frame exists", async () => {
    const folder: PluginFolder = {
      name: "tracer",
      files: [{ path: "index.js", bytes: new TextEncoder().encode("export {};") }],
    };
    const createFrame = vi.fn(() => fakePluginFrame());
    const result = await start(folder, { createFrame });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe("manifest-invalid");
    expect(createFrame).not.toHaveBeenCalled();
  });

  it("refuses refused imports, before any frame exists", async () => {
    const folder = pluginFolder({ "index.js": 'import React from "react";' });
    const createFrame = vi.fn(() => fakePluginFrame());
    const result = await start(folder, { createFrame });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe("module-refused");
    expect(createFrame).not.toHaveBeenCalled();
  });

  it("stops a plugin that never signals ready with a startup timeout", async () => {
    const frame = fakePluginFrame({ ready: false });
    const result = await start(pluginFolder({}), {
      createFrame: () => frame,
      timeoutMs: 20,
    });
    expect(result).toEqual({ ok: false, refusal: { code: "startup-timeout" } });
    expect(frame.stopped).toBe(true);
  });

  it("reports a Worker error as a refusal", async () => {
    const frame = fakePluginFrame({ fail: "boom" });
    const result = await start(pluginFolder({}), {
      createFrame: () => frame,
      timeoutMs: 1000,
    });
    expect(result).toEqual({ ok: false, refusal: { code: "worker-error", message: "boom" } });
    expect(frame.stopped).toBe(true);
  });

  it("refuses when the plugin does not answer the health check", async () => {
    const frame = fakePluginFrame();
    frame.healthAnswer = "refuse";
    const result = await start(pluginFolder({}), {
      createFrame: () => frame,
      timeoutMs: 1000,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe("health-check-failed");
    expect(frame.stopped).toBe(true);
  });
});
