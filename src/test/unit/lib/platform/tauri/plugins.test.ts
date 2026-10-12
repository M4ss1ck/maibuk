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

describe("createTauriPluginDirectory(): install, remove, and directory ops (#443)", () => {
  it("reports the desktop platform and offers the desktop-only operations", () => {
    const adapter = createTauriPluginDirectory();
    expect(adapter.kind).toBe("desktop");
    expect(adapter.addFromFolder).toBeDefined();
    expect(adapter.openDirectory).toBeDefined();
    expect(adapter.changeDirectory).toBeDefined();
    expect(adapter.addFromZip).toBeDefined();
    expect(adapter.removeFolder).toBeDefined();
  });

  it("installs a .zip through Rust and resolves the Plugin id", async () => {
    mockInvoke.mockResolvedValue({ id: "tracer", hash: "h1:x" });
    const adapter = createTauriPluginDirectory();

    await expect(adapter.addFromZip?.()).resolves.toBe("tracer");
    expect(mockInvoke).toHaveBeenCalledWith("add_plugin_from_zip");
  });

  it("resolves null when the .zip picker is cancelled", async () => {
    mockInvoke.mockResolvedValue(null);
    const adapter = createTauriPluginDirectory();

    await expect(adapter.addFromZip?.()).resolves.toBeNull();
  });

  it("installs from a folder on desktop", async () => {
    mockInvoke.mockResolvedValue({ id: "tracer", hash: "h1:x" });
    const adapter = createTauriPluginDirectory();

    await expect(adapter.addFromFolder?.()).resolves.toBe("tracer");
    expect(mockInvoke).toHaveBeenCalledWith("add_plugin_from_folder");
  });

  it("removes a Plugin folder through Rust, passing the id", async () => {
    mockInvoke.mockResolvedValue(true);
    const adapter = createTauriPluginDirectory();

    await expect(adapter.removeFolder?.("tracer")).resolves.toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith("remove_plugin_folder", { id: "tracer" });
  });

  it("reports a folder that was already gone as not removed", async () => {
    mockInvoke.mockResolvedValue(false);
    const adapter = createTauriPluginDirectory();

    await expect(adapter.removeFolder?.("absent")).resolves.toBe(false);
  });

  it("opens the Plugin Directory through Rust", async () => {
    mockInvoke.mockResolvedValue(undefined);
    const adapter = createTauriPluginDirectory();

    await adapter.openDirectory?.();

    expect(mockInvoke).toHaveBeenCalledWith("open_plugin_directory");
  });

  it("changes the Plugin Directory through the native picker", async () => {
    mockInvoke.mockResolvedValue("/home/a/Maibuk/Plugins");
    const adapter = createTauriPluginDirectory();

    await expect(adapter.changeDirectory?.()).resolves.toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith("pick_plugin_directory", { defaultPath: null });
  });

  it("reports no change when the directory picker is cancelled", async () => {
    mockInvoke.mockResolvedValue(null);
    const adapter = createTauriPluginDirectory();

    await expect(adapter.changeDirectory?.()).resolves.toBe(false);
  });
});

describe("createTauriPluginDirectory() on Android (#443)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("reports android and omits the desktop-only operations", async () => {
    vi.stubEnv("VITE_BUILD_TARGET", "tauri");
    vi.stubEnv("TAURI_ENV_PLATFORM", "android");
    vi.resetModules();
    const { createTauriPluginDirectory: createAndroidPluginDirectory } = await import(
      "@/lib/platform/tauri/plugins"
    );
    const adapter = createAndroidPluginDirectory();

    expect(adapter.kind).toBe("android");
    expect(adapter.addFromZip).toBeDefined();
    expect(adapter.removeFolder).toBeDefined();
    expect(adapter.addFromFolder).toBeUndefined();
    expect(adapter.openDirectory).toBeUndefined();
    expect(adapter.changeDirectory).toBeUndefined();
  });
});
