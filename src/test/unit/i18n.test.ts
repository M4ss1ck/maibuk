import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/locales/en.json";
import es from "@/locales/es.json";

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

describe("locale key coverage", () => {
  it("defines common.increaseValue in both locales", () => {
    expect(en.common.increaseValue).toBeTruthy();
    expect(es.common.increaseValue).toBeTruthy();
  });

  it("defines common.decreaseValue in both locales", () => {
    expect(en.common.decreaseValue).toBeTruthy();
    expect(es.common.decreaseValue).toBeTruthy();
  });

  it("defines common.closeChapters in both locales", () => {
    expect(en.common.closeChapters).toBeTruthy();
    expect(es.common.closeChapters).toBeTruthy();
  });

  it("defines sync.syncStatus in both locales", () => {
    expect(en.sync.syncStatus).toBeTruthy();
    expect(es.sync.syncStatus).toBeTruthy();
  });

  it("defines settings.themeDropdown interpolation key in both locales", () => {
    expect(en.settings.themeDropdown).toContain("{{theme}}");
    expect(es.settings.themeDropdown).toContain("{{theme}}");
  });

  it("defines the cover paint color label in both locales", () => {
    expect(en.cover.paint.color).toBeTruthy();
    expect(es.cover.paint.color).toBeTruthy();
  });

  it("defines the close backup trigger in both locales", () => {
    expect(en.backup.trigger.close).toBeTruthy();
    expect(es.backup.trigger.close).toBeTruthy();
  });
});
