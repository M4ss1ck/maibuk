import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockInvoke = vi.hoisted(() => vi.fn());
const mockListen = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mockListen }));

import { createTauriPluginDirectory } from "@/lib/platform/tauri/plugins";

beforeEach(() => {
  mockInvoke.mockReset();
  mockListen.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createTauriPluginDirectory()", () => {
  it("lists the Plugin folders through the Rust command", async () => {
    mockInvoke.mockResolvedValue(["alpha", "tracer"]);
    const adapter = createTauriPluginDirectory();

    await expect(adapter.listFolders()).resolves.toEqual(["alpha", "tracer"]);
    expect(mockInvoke).toHaveBeenCalledWith("list_plugin_folders");
  });

  it("reads a folder's files with the exact bytes and the hash Rust computed", async () => {
    mockInvoke.mockResolvedValue({
      name: "tracer",
      hash: "h1:P6TsEygkciGHh0nUfbDHf4TRJail2OmZxMAlJyOCSCk=",
      files: [
        { path: "manifest.json", bytes: btoa("{}") },
        { path: "index.js", bytes: btoa("export {}") },
      ],
    });
    const adapter = createTauriPluginDirectory();

    const folder = await adapter.readFolder("tracer");

    expect(mockInvoke).toHaveBeenCalledWith("read_plugin_folder", { name: "tracer" });
    expect(folder?.name).toBe("tracer");
    expect(folder?.hash).toBe("h1:P6TsEygkciGHh0nUfbDHf4TRJail2OmZxMAlJyOCSCk=");
    expect(folder?.files.map((file) => file.path)).toEqual(["manifest.json", "index.js"]);
    expect(new TextDecoder().decode(folder?.files[1].bytes)).toBe("export {}");
  });

  it("omits the hash when Rust refused the folder's paths", async () => {
    mockInvoke.mockResolvedValue({
      name: "tracer",
      hash: null,
      files: [{ path: "data/a\nb.txt", bytes: btoa("contents") }],
    });
    const adapter = createTauriPluginDirectory();

    const folder = await adapter.readFolder("tracer");

    expect(folder?.hash).toBeUndefined();
    expect(folder?.files).toHaveLength(1);
  });

  it("reads a missing or refused folder as null", async () => {
    mockInvoke.mockResolvedValue(null);
    const adapter = createTauriPluginDirectory();
    await expect(adapter.readFolder("absent")).resolves.toBeNull();

    mockInvoke.mockRejectedValue("PLUGIN_FOLDER_SYMLINK: tracer/leak.txt");
    await expect(adapter.readFolder("tracer")).resolves.toBeNull();
  });

  it("reports an empty directory when the Rust side cannot be reached", async () => {
    mockInvoke.mockRejectedValue(new Error("no __TAURI_INTERNALS__"));
    const adapter = createTauriPluginDirectory();

    await expect(adapter.listFolders()).resolves.toEqual([]);
    await expect(adapter.readFolder("tracer")).resolves.toBeNull();
  });

  it("watches the Plugin Directory and routes plugins://changed to onChanged", async () => {
    const unlisten = vi.fn();
    mockListen.mockResolvedValue(unlisten);
    mockInvoke.mockResolvedValue(undefined);
    const adapter = createTauriPluginDirectory();
    const seen: string[] = [];

    const stop = adapter.watch?.((id) => seen.push(id));
    await vi.waitFor(() => expect(mockListen).toHaveBeenCalled());

    expect(mockInvoke).toHaveBeenCalledWith("watch_plugin_directory");
    expect(mockListen).toHaveBeenCalledWith("plugins://changed", expect.any(Function));

    const callback = mockListen.mock.calls[0][1] as (event: {
      payload: { id: string };
    }) => void;
    callback({ payload: { id: "tracer" } });
    expect(seen).toEqual(["tracer"]);

    stop?.();
    expect(unlisten).toHaveBeenCalled();
    expect(mockInvoke).toHaveBeenCalledWith("unwatch_plugin_directory");
  });

  it("stops the listener when the unsubscribe runs before listen resolves", async () => {
    const pending: { resolve: (stop: () => void) => void } = { resolve: () => undefined };
    const unlisten = vi.fn();
    mockListen.mockImplementation(
      () =>
        new Promise<() => void>((resolve) => {
          pending.resolve = resolve;
        })
    );
    mockInvoke.mockResolvedValue(undefined);
    const adapter = createTauriPluginDirectory();

    const stop = adapter.watch?.(() => undefined);
    stop?.();
    pending.resolve(unlisten);

    await vi.waitFor(() => expect(unlisten).toHaveBeenCalled());
  });
});
