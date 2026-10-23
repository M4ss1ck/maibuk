import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  normalizeWindowBackground,
  resetWindowBackgroundForTests,
  syncWindowBackground,
} from "@/features/theme/window-background";

const { mockSetWindowBackground } = vi.hoisted(() => ({
  mockSetWindowBackground: vi.fn<(color: string) => Promise<void>>().mockResolvedValue(undefined),
}));

vi.mock("@/lib/platform", () => ({
  setWindowBackground: mockSetWindowBackground,
}));

function withComputedBackground(value: string): void {
  vi.spyOn(window, "getComputedStyle").mockReturnValue({
    getPropertyValue: (property: string) => (property === "--color-background" ? value : ""),
  } as unknown as CSSStyleDeclaration);
}

describe("normalizeWindowBackground()", () => {
  it("keeps a six-digit hex color, lowercased", () => {
    expect(normalizeWindowBackground("#FAFAF9")).toBe("#fafaf9");
    expect(normalizeWindowBackground("  #1C1917  ")).toBe("#1c1917");
  });

  it("expands a three-digit hex color", () => {
    expect(normalizeWindowBackground("#abc")).toBe("#aabbcc");
  });

  it("converts an rgb() color to hex", () => {
    expect(normalizeWindowBackground("rgb(250, 250, 249)")).toBe("#fafaf9");
    expect(normalizeWindowBackground("rgb(0 0 0)")).toBe("#000000");
  });

  it("rejects values that are not a hex or rgb color", () => {
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
    vi.restoreAllMocks();
    resetWindowBackgroundForTests();
    mockSetWindowBackground.mockClear();
  });

  it("reports the resolved background", async () => {
    withComputedBackground("#fafaf9");

    syncWindowBackground();

    await vi.waitFor(() => expect(mockSetWindowBackground).toHaveBeenCalledTimes(1));
    expect(mockSetWindowBackground).toHaveBeenCalledWith("#fafaf9");
  });

  it("does not report the same background twice in a session", async () => {
    withComputedBackground("#1c1917");

    syncWindowBackground();
    syncWindowBackground();

    await vi.waitFor(() => expect(mockSetWindowBackground).toHaveBeenCalledTimes(1));
    expect(mockSetWindowBackground).toHaveBeenCalledWith("#1c1917");
  });

  it("reports again when the resolved background changes", async () => {
    withComputedBackground("#fafaf9");
    syncWindowBackground();
    withComputedBackground("#1c1917");
    syncWindowBackground();

    await vi.waitFor(() => expect(mockSetWindowBackground).toHaveBeenCalledTimes(2));
    expect(mockSetWindowBackground).toHaveBeenNthCalledWith(1, "#fafaf9");
    expect(mockSetWindowBackground).toHaveBeenNthCalledWith(2, "#1c1917");
  });

  it("skips an empty or unusable background", () => {
    withComputedBackground("");

    syncWindowBackground();

    expect(mockSetWindowBackground).not.toHaveBeenCalled();
  });

  it("lands reports in call order even when the platform is slow", async () => {
    const resolvers: Array<() => void> = [];
    const deferred = () => new Promise<void>((resolve) => resolvers.push(resolve));
    mockSetWindowBackground.mockImplementationOnce(deferred).mockImplementationOnce(deferred);

    withComputedBackground("#fafaf9");
    syncWindowBackground();
    withComputedBackground("#1c1917");
    syncWindowBackground();

    // The second report waits for the first, so a fast toggle cannot persist
    // the older color last.
    await vi.waitFor(() => expect(mockSetWindowBackground).toHaveBeenCalledTimes(1));
    expect(mockSetWindowBackground).toHaveBeenLastCalledWith("#fafaf9");

    resolvers[0]?.();
    await vi.waitFor(() => expect(mockSetWindowBackground).toHaveBeenCalledTimes(2));
    expect(mockSetWindowBackground).toHaveBeenLastCalledWith("#1c1917");

    resolvers[1]?.();
  });

  it("never throws when the platform report rejects", async () => {
    mockSetWindowBackground.mockRejectedValueOnce(new Error("no window"));
    withComputedBackground("#fafaf9");

    expect(() => syncWindowBackground()).not.toThrow();

    await vi.waitFor(() => expect(mockSetWindowBackground).toHaveBeenCalledTimes(1));
  });
});
