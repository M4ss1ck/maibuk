import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: vi.fn(),
  writeText: vi.fn(),
}));

const { tauriClipboard } = await import("@/lib/platform/tauri/clipboard");

/** The command's response: the MIME type, one `\n`, then the file bytes. */
function copiedFileResponse(type: string, bytes: number[]): ArrayBuffer {
  const payload = [...new TextEncoder().encode(`${type}\n`), ...bytes];
  return new Uint8Array(payload).buffer;
}

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("tauriClipboard.readCopiedImageFile", () => {
  it("builds the copied file's Blob from the command's response", async () => {
    mockInvoke.mockResolvedValue(copiedFileResponse("image/png", [1, 2, 3]));

    const blob = await tauriClipboard.readCopiedImageFile();

    expect(mockInvoke).toHaveBeenCalledWith("read_clipboard_image_file");
    expect(blob?.type).toBe("image/png");
    expect(new Uint8Array(await blob!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("returns null when the clipboard names no copied image file", async () => {
    mockInvoke.mockResolvedValue(new ArrayBuffer(0));

    await expect(tauriClipboard.readCopiedImageFile()).resolves.toBeNull();
  });

  it("lets a rejected command reject, as it means the copied file is too large", async () => {
    mockInvoke.mockRejectedValue("too large");

    await expect(tauriClipboard.readCopiedImageFile()).rejects.toBe("too large");
  });
});
