import { beforeEach, describe, expect, it, vi } from "vitest";

const { getOSMock } = vi.hoisted(() => ({
  getOSMock: vi.fn(),
}));

vi.mock("../../lib/platform", () => ({
  getOS: getOSMock,
}));

import { detectSystemLocale } from "@/i18n";

describe("detectSystemLocale()", () => {
  beforeEach(() => {
    getOSMock.mockReset();
  });

  it("returns normalized language when locale is supported", async () => {
    getOSMock.mockResolvedValue({
      locale: vi.fn().mockResolvedValue("es-ES"),
    });

    await expect(detectSystemLocale()).resolves.toBe("es");
  });

  it("falls back to en when locale is unsupported", async () => {
    getOSMock.mockResolvedValue({
      locale: vi.fn().mockResolvedValue("fr-FR"),
    });

    await expect(detectSystemLocale()).resolves.toBe("en");
  });

  it("falls back to en when locale is empty", async () => {
    getOSMock.mockResolvedValue({
      locale: vi.fn().mockResolvedValue(""),
    });

    await expect(detectSystemLocale()).resolves.toBe("en");
  });

  it("falls back to en when OS lookup fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    getOSMock.mockRejectedValue(new Error("os unavailable"));

    await expect(detectSystemLocale()).resolves.toBe("en");

    warnSpy.mockRestore();
  });
});
