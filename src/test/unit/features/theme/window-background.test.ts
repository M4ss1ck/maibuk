import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSetWindowBackground } = vi.hoisted(() => ({
  mockSetWindowBackground: vi.fn<(color: string) => Promise<void>>().mockResolvedValue(undefined),
}));

vi.mock("@/lib/platform", () => ({
  setWindowBackground: mockSetWindowBackground,
}));

type WindowBackgroundModule = typeof import("@/features/theme/window-background");

// Each case starts from a fresh module so the session's de-duplication does not
// leak between them.
async function loadModule(): Promise<WindowBackgroundModule> {
  vi.resetModules();
  return import("@/features/theme/window-background");
}

function withComputedBackground(value: string): void {
  vi.spyOn(window, "getComputedStyle").mockReturnValue({
    getPropertyValue: (property: string) => (property === "--color-background" ? value : ""),
  } as unknown as CSSStyleDeclaration);
}

describe("normalizeWindowBackground()", () => {
  it("keeps a six-digit hex color, lowercased", async () => {
    const { normalizeWindowBackground } = await loadModule();
    expect(normalizeWindowBackground("#FAFAF9")).toBe("#fafaf9");
    expect(normalizeWindowBackground("  #1C1917  ")).toBe("#1c1917");
  });

  it("expands a three-digit hex color", async () => {
    const { normalizeWindowBackground } = await loadModule();
    expect(normalizeWindowBackground("#abc")).toBe("#aabbcc");
  });

  it("converts an rgb() color to hex", async () => {
    const { normalizeWindowBackground } = await loadModule();
    expect(normalizeWindowBackground("rgb(250, 250, 249)")).toBe("#fafaf9");
    expect(normalizeWindowBackground("rgb(0 0 0)")).toBe("#000000");
  });

  it("rejects values that are not a hex or rgb color", async () => {
    const { normalizeWindowBackground } = await loadModule();
    for (const value of [
      "",
      "   ",
      "transparent",
      "var(--color-background)",
      "#12345",
      "#1234567",
      "rgb(256, 0, 0)",
      "rgb(1, 2)",
    ]) {
      expect(normalizeWindowBackground(value)).toBeNull();
    }
  });
});

describe("syncWindowBackground()", () => {
  beforeEach(() => {
    mockSetWindowBackground.mockClear();
    vi.restoreAllMocks();
  });

  it("reports the resolved background", async () => {
    const { syncWindowBackground } = await loadModule();
    withComputedBackground("#fafaf9");

    syncWindowBackground();

    expect(mockSetWindowBackground).toHaveBeenCalledTimes(1);
    expect(mockSetWindowBackground).toHaveBeenCalledWith("#fafaf9");
  });

  it("does not report the same background twice in a session", async () => {
    const { syncWindowBackground } = await loadModule();
    withComputedBackground("#1c1917");

    syncWindowBackground();
    syncWindowBackground();

    expect(mockSetWindowBackground).toHaveBeenCalledTimes(1);
  });

  it("reports again when the resolved background changes", async () => {
    const { syncWindowBackground } = await loadModule();
    withComputedBackground("#fafaf9");
    syncWindowBackground();
    withComputedBackground("#1c1917");
    syncWindowBackground();

    expect(mockSetWindowBackground).toHaveBeenNthCalledWith(1, "#fafaf9");
    expect(mockSetWindowBackground).toHaveBeenNthCalledWith(2, "#1c1917");
  });

  it("skips an empty or unusable background", async () => {
    const { syncWindowBackground } = await loadModule();
    withComputedBackground("");

    syncWindowBackground();

    expect(mockSetWindowBackground).not.toHaveBeenCalled();
  });

  it("never throws when the platform report rejects", async () => {
    const { syncWindowBackground } = await loadModule();
    mockSetWindowBackground.mockRejectedValueOnce(new Error("no window"));
    withComputedBackground("#fafaf9");

    expect(() => syncWindowBackground()).not.toThrow();
  });
});
