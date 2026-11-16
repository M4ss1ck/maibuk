import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockInvoke, mockReadImage } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockReadImage: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: vi.fn(),
  writeText: vi.fn(),
  readImage: mockReadImage,
}));

const { tauriClipboard } = await import("@/lib/platform/tauri/clipboard");

/** The command's response: the MIME type, one `\n`, then the file bytes. */
function copiedFileResponse(type: string, bytes: number[]): ArrayBuffer {
  const payload = [...new TextEncoder().encode(`${type}\n`), ...bytes];
  return new Uint8Array(payload).buffer;
}

beforeEach(() => {
  mockInvoke.mockReset();
  mockReadImage.mockReset();
});

describe("tauriClipboard.readImage", () => {
  it("builds the copied file's Blob from the command's response", async () => {
    mockInvoke.mockResolvedValue(copiedFileResponse("image/png", [1, 2, 3]));

    const blob = await tauriClipboard.readImage();

    expect(mockInvoke).toHaveBeenCalledWith("read_clipboard_image_file");
    expect(blob?.type).toBe("image/png");
    expect(new Uint8Array(await blob!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("returns null when no file is copied and no picture is on the clipboard", async () => {
    mockInvoke.mockResolvedValue(new ArrayBuffer(0));
    mockReadImage.mockRejectedValue(new Error("no image on the clipboard"));

    await expect(tauriClipboard.readImage()).resolves.toBeNull();
  });

  it("lets a rejected command reject, as it means the copied file is too large", async () => {
    mockInvoke.mockRejectedValue("too large");

    await expect(tauriClipboard.readImage()).rejects.toBe("too large");
    expect(mockReadImage).not.toHaveBeenCalled();
  });
});
