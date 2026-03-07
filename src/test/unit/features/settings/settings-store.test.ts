import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock i18n before importing the store
const { mockChangeLanguage } = vi.hoisted(() => ({
  mockChangeLanguage: vi.fn(),
}));

vi.mock("../../../../i18n", () => ({
  default: {
    language: "en",
    changeLanguage: mockChangeLanguage,
  },
  detectSystemLocale: vi.fn().mockResolvedValue("en"),
}));

const { useSettingsStore } = await import(
  "../../../../features/settings/store"
);

describe("useSettingsStore", () => {
  beforeEach(() => {
    // Clear localStorage to avoid persisted state leaking between tests
    localStorage.clear();
    mockChangeLanguage.mockClear();

    // Reset store to defaults
    useSettingsStore.setState({
      appFontSize: 16,
      appFont: "sans",
      primaryColor: "#3B82F6",
      autoSave: true,
      language: "en",
      spellCheckEnabled: true,
      customDictionary: [],
      dictionaryOpenInBrowser: false,
      showInlineFootnotes: true,
      showNotesChapter: false,
      hideKeyboardHints: false,
      defaultExportFormat: "epub",
      lastPath: null,
    });
  });

  describe("initial defaults", () => {
    it("has correct default values", () => {
      const state = useSettingsStore.getState();
      expect(state.appFontSize).toBe(16);
      expect(state.appFont).toBe("sans");
      expect(state.autoSave).toBe(true);
      expect(state.language).toBe("en");
      expect(state.spellCheckEnabled).toBe(true);
      expect(state.customDictionary).toEqual([]);
      expect(state.hideKeyboardHints).toBe(false);
      expect(state.defaultExportFormat).toBe("epub");
      expect(state.lastPath).toBeNull();
    });
  });

  describe("setAppFontSize()", () => {
    it("updates the font size", () => {
      useSettingsStore.getState().setAppFontSize(20);
      expect(useSettingsStore.getState().appFontSize).toBe(20);
    });
  });

  describe("setAppFont()", () => {
    it("updates the font family", () => {
      useSettingsStore.getState().setAppFont("serif");
      expect(useSettingsStore.getState().appFont).toBe("serif");
    });
  });

  describe("setPrimaryColor()", () => {
    it("sets a valid 6-digit hex color", () => {
      useSettingsStore.getState().setPrimaryColor("#ff5500");
      expect(useSettingsStore.getState().primaryColor).toBe("#FF5500");
    });

    it("expands 3-digit hex to 6-digit", () => {
      useSettingsStore.getState().setPrimaryColor("#f50");
      expect(useSettingsStore.getState().primaryColor).toBe("#FF5500");
    });

    it("falls back to default for invalid color", () => {
      useSettingsStore.getState().setPrimaryColor("not-a-color");
      expect(useSettingsStore.getState().primaryColor).toBe("#3B82F6");
    });

    it("trims whitespace", () => {
      useSettingsStore.getState().setPrimaryColor("  #aabbcc  ");
      expect(useSettingsStore.getState().primaryColor).toBe("#AABBCC");
    });
  });

  describe("setAutoSave()", () => {
    it("toggles auto-save off", () => {
      useSettingsStore.getState().setAutoSave(false);
      expect(useSettingsStore.getState().autoSave).toBe(false);
    });
  });

  describe("setDefaultExportFormat()", () => {
    it("changes the default export format", () => {
      useSettingsStore.getState().setDefaultExportFormat("pdf");
      expect(useSettingsStore.getState().defaultExportFormat).toBe("pdf");
    });
  });

  describe("setLanguage()", () => {
    it("updates language and calls i18n.changeLanguage", () => {
      useSettingsStore.getState().setLanguage("es");

      expect(useSettingsStore.getState().language).toBe("es");
      expect(mockChangeLanguage).toHaveBeenCalledWith("es");
    });
  });

  describe("setSpellCheckEnabled()", () => {
    it("toggles spell check", () => {
      useSettingsStore.getState().setSpellCheckEnabled(false);
      expect(useSettingsStore.getState().spellCheckEnabled).toBe(false);
    });
  });

  describe("addCustomWord()", () => {
    it("adds a word to custom dictionary", () => {
      useSettingsStore.getState().addCustomWord("Maibuk");
      expect(useSettingsStore.getState().customDictionary).toContain("Maibuk");
    });

    it("trims whitespace from words", () => {
      useSettingsStore.getState().addCustomWord("  spacey  ");
      expect(useSettingsStore.getState().customDictionary).toContain("spacey");
    });

    it("ignores empty strings", () => {
      useSettingsStore.getState().addCustomWord("   ");
      expect(useSettingsStore.getState().customDictionary).toHaveLength(0);
    });

    it("prevents case-insensitive duplicates", () => {
      useSettingsStore.getState().addCustomWord("Hello");
      useSettingsStore.getState().addCustomWord("hello");
      useSettingsStore.getState().addCustomWord("HELLO");

      expect(useSettingsStore.getState().customDictionary).toHaveLength(1);
    });
  });

  describe("removeCustomWord()", () => {
    it("removes a word case-insensitively", () => {
      useSettingsStore.getState().addCustomWord("Remove");
      useSettingsStore.getState().removeCustomWord("remove");

      expect(useSettingsStore.getState().customDictionary).toHaveLength(0);
    });

    it("ignores empty strings", () => {
      useSettingsStore.getState().addCustomWord("Keep");
      useSettingsStore.getState().removeCustomWord("   ");

      expect(useSettingsStore.getState().customDictionary).toHaveLength(1);
    });
  });

  describe("setDictionaryOpenInBrowser()", () => {
    it("enables dictionary browser opening", () => {
      useSettingsStore.getState().setDictionaryOpenInBrowser(true);
      expect(useSettingsStore.getState().dictionaryOpenInBrowser).toBe(true);
    });
  });

  describe("setShowInlineFootnotes()", () => {
    it("toggles inline footnotes", () => {
      useSettingsStore.getState().setShowInlineFootnotes(false);
      expect(useSettingsStore.getState().showInlineFootnotes).toBe(false);
    });
  });

  describe("setShowNotesChapter()", () => {
    it("toggles notes chapter", () => {
      useSettingsStore.getState().setShowNotesChapter(true);
      expect(useSettingsStore.getState().showNotesChapter).toBe(true);
    });
  });

  describe("setHideKeyboardHints()", () => {
    it("toggles keyboard hints visibility", () => {
      useSettingsStore.getState().setHideKeyboardHints(true);
      expect(useSettingsStore.getState().hideKeyboardHints).toBe(true);
    });
  });

  describe("setLastPath()", () => {
    it("sets the last visited path", () => {
      useSettingsStore.getState().setLastPath("/book/123");
      expect(useSettingsStore.getState().lastPath).toBe("/book/123");
    });

    it("clears the last path with null", () => {
      useSettingsStore.getState().setLastPath("/book/123");
      useSettingsStore.getState().setLastPath(null);
      expect(useSettingsStore.getState().lastPath).toBeNull();
    });
  });
});
