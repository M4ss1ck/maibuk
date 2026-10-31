/**
 * The desktop File Grant store (ADR 0036): every operation goes through a Rust
 * command with arguments in camelCase, a refused command becomes a
 * `PluginApiError` carrying its stable code, and no message ever names a path.
 * The Rust side checks the grant, so `requestAccess` answers true without
 * crossing IPC.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockInvoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));

import { PluginApiError } from "@/plugin-sdk/protocol";
import { createTauriPluginFileGrantStore } from "@/lib/platform/tauri/file-grants";

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("createTauriPluginFileGrantStore()", () => {
  it("picks a file through Rust, filtered to the Plugin's extensions", async () => {
    mockInvoke.mockResolvedValue({ grant: "a1b2", name: "book.pdf", size: 2048 });
    const store = createTauriPluginFileGrantStore();

    await expect(store.pick("tracer", ["pdf", "epub"])).resolves.toEqual({
      grant: "a1b2",
      name: "book.pdf",
      size: 2048,
    });
    expect(mockInvoke).toHaveBeenCalledWith("plugin_files_pick", {
      pluginId: "tracer",
      extensions: ["pdf", "epub"],
    });
  });

  it("returns null when the author cancels the picker", async () => {
    mockInvoke.mockResolvedValue(null);
    const store = createTauriPluginFileGrantStore();

    await expect(store.pick("tracer", ["pdf"])).resolves.toBeNull();
  });

  it("reads a byte range and hands back the ArrayBuffer Rust sent", async () => {
    const bytes = new TextEncoder().encode("contents").buffer;
    mockInvoke.mockResolvedValue(bytes);
    const store = createTauriPluginFileGrantStore();

    const read = await store.read("tracer", "a1b2", 4, 3);

    expect(mockInvoke).toHaveBeenCalledWith("plugin_files_read", {
      pluginId: "tracer",
      grant: "a1b2",
      offset: 4,
      length: 3,
    });
    expect(read).toBe(bytes);
  });

  it("stats a grant through Rust", async () => {
    mockInvoke.mockResolvedValue({ name: "book.pdf", size: 2048, modified: 1_700_000_000_000 });
    const store = createTauriPluginFileGrantStore();

    await expect(store.stat("tracer", "a1b2")).resolves.toEqual({
      name: "book.pdf",
      size: 2048,
      modified: 1_700_000_000_000,
    });
    expect(mockInvoke).toHaveBeenCalledWith("plugin_files_stat", {
      pluginId: "tracer",
      grant: "a1b2",
    });
  });

  it("lists the Plugin's grants through Rust", async () => {
    mockInvoke.mockResolvedValue([{ grant: "a1b2", name: "book.pdf", size: 2048 }]);
    const store = createTauriPluginFileGrantStore();

    await expect(store.list("tracer")).resolves.toEqual([
      { grant: "a1b2", name: "book.pdf", size: 2048 },
    ]);
    expect(mockInvoke).toHaveBeenCalledWith("plugin_files_list", { pluginId: "tracer" });
  });

  it("releases one grant through Rust", async () => {
    mockInvoke.mockResolvedValue(undefined);
    const store = createTauriPluginFileGrantStore();

    await store.release("tracer", "a1b2");

    expect(mockInvoke).toHaveBeenCalledWith("plugin_files_release", {
      pluginId: "tracer",
      grant: "a1b2",
    });
  });

  it("clears one Plugin's grants, then every grant, through Rust", async () => {
    mockInvoke.mockResolvedValue(undefined);
    const store = createTauriPluginFileGrantStore();

    await store.clearPlugin("tracer");
    await store.clearAll();

    expect(mockInvoke).toHaveBeenNthCalledWith(1, "plugin_files_clear_plugin", {
      pluginId: "tracer",
    });
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "plugin_files_clear_all");
  });

  it("answers requestAccess true without asking a browser", async () => {
    const store = createTauriPluginFileGrantStore();

    await expect(store.requestAccess("tracer", "a1b2")).resolves.toBe(true);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("turns a file-missing refusal into a PluginApiError with the file-missing code", async () => {
    // Tauri rejects a `Result::Err(String)` command with the bare string.
    mockInvoke.mockRejectedValue("file-missing: the file behind this File Grant is gone");
    const store = createTauriPluginFileGrantStore();

    const error = await store.read("tracer", "a1b2", 0, 4).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(PluginApiError);
    expect((error as PluginApiError).code).toBe("file-missing");
    expect((error as PluginApiError).message).toBe("the file behind this File Grant is gone");
  });

  it("turns an invalid-params refusal into a PluginApiError with the invalid-params code", async () => {
    mockInvoke.mockRejectedValue("invalid-params: a read is capped at 4128768 bytes");
    const store = createTauriPluginFileGrantStore();

    const error = await store.read("tracer", "a1b2", 0, 4).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(PluginApiError);
    expect((error as PluginApiError).code).toBe("invalid-params");
    expect((error as PluginApiError).message).toBe("a read is capped at 4128768 bytes");
  });

  it("maps a refusal on every command, not only read", async () => {
    mockInvoke.mockRejectedValue("file-missing: this Plugin holds no such File Grant");
    const store = createTauriPluginFileGrantStore();

    for (const call of [
      () => store.pick("tracer", ["pdf"]),
      () => store.stat("tracer", "a1b2"),
      () => store.release("tracer", "a1b2"),
      () => store.list("tracer"),
    ]) {
      const error = await call().catch((failure: unknown) => failure);
      expect(error).toBeInstanceOf(PluginApiError);
      expect((error as PluginApiError).code).toBe("file-missing");
    }
  });

  it("keeps a path out of the message, matching the prefix and dropping nothing else", async () => {
    mockInvoke.mockRejectedValue("file-missing: the file behind this File Grant is gone");
    const store = createTauriPluginFileGrantStore();

    const error = (await store
      .stat("tracer", "a1b2")
      .catch((failure: unknown) => failure)) as PluginApiError;

    expect(error.message).not.toContain("/home/");
    expect(error.message).not.toContain(":");
  });

  it("rethrows a failure that carries no stable prefix unchanged", async () => {
    const failure = new Error("the Plugin secret store is unavailable on this device");
    mockInvoke.mockRejectedValue(failure);
    const store = createTauriPluginFileGrantStore();

    await expect(store.clearAll()).rejects.toBe(failure);
  });
});
