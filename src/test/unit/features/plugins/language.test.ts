import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { currentPluginLanguage, onPluginLanguageChange } from "@/features/plugins/language";

describe("Plugin language", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("reads the language Maibuk runs in", async () => {
    await i18n.changeLanguage("es");
    expect(currentPluginLanguage()).toBe("es");
    await i18n.changeLanguage("en");
    expect(currentPluginLanguage()).toBe("en");
  });

  it("reports every change after the subscription, in order", async () => {
    const seen: string[] = [];
    const off = onPluginLanguageChange((language) => seen.push(language));
    try {
      await i18n.changeLanguage("es");
      await i18n.changeLanguage("en");
      await i18n.changeLanguage("es");
      expect(seen).toEqual(["es", "en", "es"]);
    } finally {
      off();
    }

    await i18n.changeLanguage("en");
    expect(seen).toEqual(["es", "en", "es"]);
  });

  it("never throws when a listener does", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const good = vi.fn();
    const offBad = onPluginLanguageChange(() => {
      throw new Error("boom");
    });
    const offGood = onPluginLanguageChange(good);
    try {
      await i18n.changeLanguage("es");
      expect(good).toHaveBeenCalledWith("es");
      expect(logged).toHaveBeenCalled();
    } finally {
      offBad();
      offGood();
      logged.mockRestore();
    }
  });
});
