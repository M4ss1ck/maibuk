import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockReadText = vi.hoisted(() => vi.fn());
const mockWriteText = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: mockReadText,
  writeText: mockWriteText,
}));

const { tauriClipboard } = await import("@/lib/platform/tauri/clipboard");
const { webClipboard } = await import("@/lib/platform/web/clipboard");

/** jsdom ships no Clipboard API; each test installs the shape it needs. */
function stubNavigatorClipboard(clipboard: {
  readText?: () => Promise<string>;
  writeText?: (text: string) => Promise<void>;
}): void {
  Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
}

afterEach(() => {
  Reflect.deleteProperty(navigator, "clipboard");
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("webClipboard (navigator.clipboard)", () => {
  it("reads the clipboard's plain text", async () => {
    const readText = vi.fn(async () => "copied text");
    stubNavigatorClipboard({ readText });

    await expect(webClipboard.readText()).resolves.toBe("copied text");
    expect(readText).toHaveBeenCalledTimes(1);
  });

  it("writes plain text to the clipboard", async () => {
    const writeText = vi.fn(async () => {});
    stubNavigatorClipboard({ writeText });

    await expect(webClipboard.writeText("hello")).resolves.toBeUndefined();
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("lets a refused browser call reject, so the caller can refuse the Plugin", async () => {
    stubNavigatorClipboard({
      readText: async () => {
        throw new DOMException("Document is not focused.", "NotAllowedError");
      },
    });

    await expect(webClipboard.readText()).rejects.toMatchObject({ name: "NotAllowedError" });
  });
});

describe("tauriClipboard (clipboard-manager plugin)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads through the clipboard-manager plugin", async () => {
    mockReadText.mockResolvedValue("os clipboard");

    await expect(tauriClipboard.readText()).resolves.toBe("os clipboard");
    expect(mockReadText).toHaveBeenCalledTimes(1);
  });

  it("writes through the clipboard-manager plugin", async () => {
    mockWriteText.mockResolvedValue(undefined);

    await expect(tauriClipboard.writeText("os text")).resolves.toBeUndefined();
    expect(mockWriteText).toHaveBeenCalledWith("os text");
  });

  it("lets a refused plugin call reject", async () => {
    mockReadText.mockRejectedValue(new Error("clipboard unavailable"));

    await expect(tauriClipboard.readText()).rejects.toThrow("clipboard unavailable");
  });
});

describe("getClipboard()", () => {
  async function loadPlatform(buildTarget: "web" | "tauri") {
    vi.stubEnv("VITE_BUILD_TARGET", buildTarget);
    vi.resetModules();
    return import("@/lib/platform");
  }

  it("serves the browser clipboard on the web build, never the plugin", async () => {
    const readText = vi.fn(async () => "web clipboard");
    const writeText = vi.fn(async () => {});
    stubNavigatorClipboard({ readText, writeText });
    mockReadText.mockClear();

    const { getClipboard } = await loadPlatform("web");
    const clipboard = await getClipboard();

    await expect(clipboard.readText()).resolves.toBe("web clipboard");
    await clipboard.writeText("web text");
    expect(writeText).toHaveBeenCalledWith("web text");
    expect(mockReadText).not.toHaveBeenCalled();
  });

  it("serves the clipboard-manager plugin off the web build", async () => {
    mockReadText.mockResolvedValue("desktop clipboard");
    mockReadText.mockClear();

    const { getClipboard } = await loadPlatform("tauri");
    const clipboard = await getClipboard();

    await expect(clipboard.readText()).resolves.toBe("desktop clipboard");
    expect(mockReadText).toHaveBeenCalledTimes(1);
  });
});
