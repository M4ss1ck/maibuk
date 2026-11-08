/**
 * The desktop Plugin File Saver (ADR 0040): Rust shows the save dialog and
 * writes the bytes to a sibling `.part` file, so the webview only learns a
 * token. Each chunk crosses IPC as raw bytes in order, the commit ends the
 * save, and any failure aborts it before the error reaches the Plugin.
 */
import { ReadableStream } from "node:stream/web";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockInvoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));

import { createTauriPluginFileSaver } from "@/lib/platform/tauri/file-save";

/** A `Blob` whose stream yields exactly `chunks`, which jsdom's own Blob cannot. */
function blobOf(...chunks: Uint8Array[]): Blob {
  return {
    stream: () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk);
          controller.close();
        },
      }),
  } as unknown as Blob;
}

const encoder = new TextEncoder();

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("createTauriPluginFileSaver()", () => {
  it("returns cancelled when the author closes the save dialog", async () => {
    mockInvoke.mockResolvedValue(null);
    const saver = createTauriPluginFileSaver();

    await expect(saver.save("map.png", "image/png", blobOf())).resolves.toBe("cancelled");

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith("plugin_files_save_begin", { name: "map.png" });
  });

  it("writes every chunk in order, then commits", async () => {
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === "plugin_files_save_begin") return 7;
      return undefined;
    });
    const saver = createTauriPluginFileSaver();
    const first = encoder.encode("abc");
    const second = encoder.encode("def");

    await expect(saver.save("map.png", "image/png", blobOf(first, second))).resolves.toBe("saved");

    expect(mockInvoke.mock.calls.map(([command]) => command)).toEqual([
      "plugin_files_save_begin",
      "plugin_files_save_write",
      "plugin_files_save_write",
      "plugin_files_save_commit",
    ]);
    expect(mockInvoke).toHaveBeenNthCalledWith(1, "plugin_files_save_begin", { name: "map.png" });
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "plugin_files_save_write", first, {
      headers: { "x-save-token": "7" },
    });
    expect(mockInvoke).toHaveBeenNthCalledWith(3, "plugin_files_save_write", second, {
      headers: { "x-save-token": "7" },
    });
    expect(mockInvoke).toHaveBeenNthCalledWith(4, "plugin_files_save_commit", { token: 7 });
  });

  it("aborts the save and rejects with the OS message when a write fails", async () => {
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === "plugin_files_save_begin") return 9;
      if (command === "plugin_files_save_write") throw "Permission denied (os error 13)";
      return undefined;
    });
    const saver = createTauriPluginFileSaver();

    await expect(saver.save("map.png", "image/png", blobOf(encoder.encode("abc")))).rejects.toThrow(
      "Permission denied (os error 13)"
    );

    expect(mockInvoke).toHaveBeenCalledWith("plugin_files_save_abort", { token: 9 });
    expect(mockInvoke).not.toHaveBeenCalledWith("plugin_files_save_commit", { token: 9 });
  });

  it("aborts the save when the commit fails", async () => {
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === "plugin_files_save_begin") return 4;
      if (command === "plugin_files_save_commit") throw "No space left on device (os error 28)";
      return undefined;
    });
    const saver = createTauriPluginFileSaver();

    await expect(saver.save("map.png", "image/png", blobOf())).rejects.toThrow(
      "No space left on device (os error 28)"
    );
    expect(mockInvoke).toHaveBeenCalledWith("plugin_files_save_abort", { token: 4 });
  });
});
