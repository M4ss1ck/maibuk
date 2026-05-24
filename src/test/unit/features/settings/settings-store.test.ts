import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  DEFAULT_METRICS_SETTINGS,
  PASTE_CLEANUP_PRESETS,
} from "../../../../features/settings/types";

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

const { useSettingsStore, normalizePasteCleanup, normalizeMetrics } = await import(
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
      backupRetention: 20,
      backupDirectory: null,
      backupListPage: 1,
      backupListPageSize: 10,
      sidebarWidth: 256,
      toolbarExpanded: false,
      chapterListView: "normal",
      pasteCleanup: {
        preset: "keepAll",
        options: { ...PASTE_CLEANUP_PRESETS.keepAll },
        rules: [],
      },
      metrics: DEFAULT_METRICS_SETTINGS,
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
      expect(state.backupRetention).toBe(20);
      expect(state.backupDirectory).toBeNull();
      expect(state.backupListPage).toBe(1);
      expect(state.backupListPageSize).toBe(10);
      expect(state.chapterListView).toBe("normal");
      expect(state.pasteCleanup.preset).toBe("keepAll");
      expect(state.pasteCleanup.rules).toEqual([]);
      expect(state.pasteCleanup.options.strippedProperties).toEqual([]);
      expect(state.metrics).toEqual(DEFAULT_METRICS_SETTINGS);
      expect(state.lastPath).toBeNull();
    });
  });

  describe("metrics settings", () => {
    it("updates a collection category without mutating the other categories", () => {
      useSettingsStore.getState().setMetricsCategoryEnabled("writing", false);

      expect(useSettingsStore.getState().metrics.enabled).toEqual({
        writing: false,
        time: true,
        engagement: true,
      });
    });

    it("normalizes malformed persisted metrics settings", () => {
      const normalized = normalizeMetrics({
        enabled: { writing: false },
        syncMetrics: true,
        streakDailyWordThreshold: 0,
        idleThresholdSec: 0,
      });

      expect(normalized).toEqual({
        enabled: { writing: false, time: true, engagement: true },
        syncMetrics: true,
        streakDailyWordThreshold: 1,
        idleThresholdSec: 1,
      });
    });
  });

  describe("backup settings", () => {
    it("updates backup retention", () => {
      useSettingsStore.getState().setBackupRetention(12);
      expect(useSettingsStore.getState().backupRetention).toBe(12);
    });

    it("clamps backup retention to at least 1", () => {
      useSettingsStore.getState().setBackupRetention(0);
      expect(useSettingsStore.getState().backupRetention).toBe(1);
    });

    it("updates backup directory", () => {
      useSettingsStore.getState().setBackupDirectory("/tmp/maibuk-backups");
      expect(useSettingsStore.getState().backupDirectory).toBe("/tmp/maibuk-backups");
    });

    it("clears backup directory with null", () => {
      useSettingsStore.getState().setBackupDirectory("/tmp/maibuk-backups");
      useSettingsStore.getState().setBackupDirectory(null);
      expect(useSettingsStore.getState().backupDirectory).toBeNull();
    });

    it("stores the selected backup list page", () => {
      useSettingsStore.getState().setBackupListPage(3);
      expect(useSettingsStore.getState().backupListPage).toBe(3);
    });

    it("clamps backup list page to at least 1", () => {
      useSettingsStore.getState().setBackupListPage(0);
      expect(useSettingsStore.getState().backupListPage).toBe(1);
    });

    it("stores allowed backup list page sizes", () => {
      for (const size of [5, 10, 25, 50] as const) {
        useSettingsStore.getState().setBackupListPageSize(size);
        expect(useSettingsStore.getState().backupListPageSize).toBe(size);
      }
    });

    it("falls back to 10 for unsupported backup list page sizes", () => {
      useSettingsStore.getState().setBackupListPageSize(12);
      expect(useSettingsStore.getState().backupListPageSize).toBe(10);
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

  describe("setSidebarWidth()", () => {
    it("updates sidebar width within bounds", () => {
      useSettingsStore.getState().setSidebarWidth(300);
      expect(useSettingsStore.getState().sidebarWidth).toBe(300);
    });

    it("clamps to minimum of 200", () => {
      useSettingsStore.getState().setSidebarWidth(100);
      expect(useSettingsStore.getState().sidebarWidth).toBe(200);
    });

    it("clamps to maximum of 480", () => {
      useSettingsStore.getState().setSidebarWidth(600);
      expect(useSettingsStore.getState().sidebarWidth).toBe(480);
    });
  });

  describe("setToolbarExpanded()", () => {
    it("toggles toolbar expanded state", () => {
      useSettingsStore.getState().setToolbarExpanded(true);
      expect(useSettingsStore.getState().toolbarExpanded).toBe(true);
    });
  });

  describe("setChapterListView()", () => {
    it("updates the chapter list view", () => {
      useSettingsStore.getState().setChapterListView("compact");
      expect(useSettingsStore.getState().chapterListView).toBe("compact");

      useSettingsStore.getState().setChapterListView("normal");
      expect(useSettingsStore.getState().chapterListView).toBe("normal");
    });
  });

  describe("setHtmlEditorLightTheme()", () => {
    it("sets HTML editor light theme", () => {
      useSettingsStore.getState().setHtmlEditorLightTheme("solarized" as any);
      expect(useSettingsStore.getState().htmlEditorLightTheme).toBe("solarized");
    });
  });

  describe("setHtmlEditorDarkTheme()", () => {
    it("sets HTML editor dark theme", () => {
      useSettingsStore.getState().setHtmlEditorDarkTheme("dracula" as any);
      expect(useSettingsStore.getState().htmlEditorDarkTheme).toBe("dracula");
    });
  });

  describe("setHtmlPanelHeight()", () => {
    it("updates HTML panel height", () => {
      useSettingsStore.getState().setHtmlPanelHeight(300);
      expect(useSettingsStore.getState().htmlPanelHeight).toBe(300);
    });

    it("clamps to minimum of 100", () => {
      useSettingsStore.getState().setHtmlPanelHeight(50);
      expect(useSettingsStore.getState().htmlPanelHeight).toBe(100);
    });
  });

  describe("setPasteCleanupPreset()", () => {
    it("applies the matchBook preset options", () => {
      useSettingsStore.getState().setPasteCleanupPreset("matchBook");
      const { pasteCleanup } = useSettingsStore.getState();
      expect(pasteCleanup.preset).toBe("matchBook");
      expect(pasteCleanup.options).toEqual(PASTE_CLEANUP_PRESETS.matchBook);
    });

    it("leaves options unchanged when selecting custom", () => {
      useSettingsStore.getState().setPasteCleanupPreset("plainText");
      const before = useSettingsStore.getState().pasteCleanup.options;
      useSettingsStore.getState().setPasteCleanupPreset("custom");
      const { pasteCleanup } = useSettingsStore.getState();
      expect(pasteCleanup.preset).toBe("custom");
      expect(pasteCleanup.options).toEqual(before);
    });
  });

  describe("setPasteCleanupOption()", () => {
    it("updates a structural option and flips the preset to custom", () => {
      useSettingsStore.getState().setPasteCleanupOption("demoteHeadings", true);
      const { pasteCleanup } = useSettingsStore.getState();
      expect(pasteCleanup.options.demoteHeadings).toBe(true);
      expect(pasteCleanup.preset).toBe("custom");
    });
  });

  describe("stripped properties", () => {
    it("adds a property and flips the preset to custom", () => {
      useSettingsStore.getState().addStrippedProperty("font-family");
      const { pasteCleanup } = useSettingsStore.getState();
      expect(pasteCleanup.options.strippedProperties).toContain("font-family");
      expect(pasteCleanup.preset).toBe("custom");
    });

    it("normalizes and de-duplicates added properties", () => {
      useSettingsStore.getState().addStrippedProperty("  Font-Size  ");
      useSettingsStore.getState().addStrippedProperty("font-size");
      expect(
        useSettingsStore.getState().pasteCleanup.options.strippedProperties,
      ).toEqual(["font-size"]);
    });

    it("removes a property", () => {
      useSettingsStore.getState().addStrippedProperty("color");
      useSettingsStore.getState().removeStrippedProperty("color");
      expect(
        useSettingsStore.getState().pasteCleanup.options.strippedProperties,
      ).not.toContain("color");
    });
  });

  describe("paste cleanup rule CRUD", () => {
    it("appends a rule with an id and sensible defaults", () => {
      useSettingsStore.getState().addPasteCleanupRule();
      const { rules } = useSettingsStore.getState().pasteCleanup;
      expect(rules).toHaveLength(1);
      expect(rules[0].id).toBeTruthy();
      expect(rules[0].enabled).toBe(true);
      expect(rules[0].target).toBe("fontFamily");
      expect(rules[0].action).toBe("removeStyle");
    });

    it("updates only the targeted rule", () => {
      useSettingsStore.getState().addPasteCleanupRule();
      useSettingsStore.getState().addPasteCleanupRule();
      const [first, second] = useSettingsStore.getState().pasteCleanup.rules;
      useSettingsStore.getState().updatePasteCleanupRule(second.id, {
        label: "Kill Comic Sans",
        value: "Comic Sans MS",
      });
      const rules = useSettingsStore.getState().pasteCleanup.rules;
      expect(rules[0]).toEqual(first);
      expect(rules[1].label).toBe("Kill Comic Sans");
      expect(rules[1].value).toBe("Comic Sans MS");
    });

    it("removes a rule by id", () => {
      useSettingsStore.getState().addPasteCleanupRule();
      const { id } = useSettingsStore.getState().pasteCleanup.rules[0];
      useSettingsStore.getState().removePasteCleanupRule(id);
      expect(useSettingsStore.getState().pasteCleanup.rules).toHaveLength(0);
    });
  });

  describe("movePasteCleanupRule()", () => {
    function addThreeRules(): string[] {
      const store = useSettingsStore.getState();
      store.addPasteCleanupRule();
      store.addPasteCleanupRule();
      store.addPasteCleanupRule();
      return useSettingsStore.getState().pasteCleanup.rules.map((r) => r.id);
    }

    it("moves a rule up", () => {
      const [a, b, c] = addThreeRules();
      useSettingsStore.getState().movePasteCleanupRule(b, "up");
      expect(
        useSettingsStore.getState().pasteCleanup.rules.map((r) => r.id)
      ).toEqual([b, a, c]);
    });

    it("does not move the first rule up", () => {
      const [a, b, c] = addThreeRules();
      useSettingsStore.getState().movePasteCleanupRule(a, "up");
      expect(
        useSettingsStore.getState().pasteCleanup.rules.map((r) => r.id)
      ).toEqual([a, b, c]);
    });

    it("does not move the last rule down", () => {
      const [a, b, c] = addThreeRules();
      useSettingsStore.getState().movePasteCleanupRule(c, "down");
      expect(
        useSettingsStore.getState().pasteCleanup.rules.map((r) => r.id)
      ).toEqual([a, b, c]);
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

describe("normalizePasteCleanup()", () => {
  it("repairs a v1 settings blob that has no strippedProperties", () => {
    const v1Blob = {
      preset: "keepAll",
      options: { removeTextColor: true, demoteHeadings: false },
      rules: [],
    };
    const result = normalizePasteCleanup(v1Blob);
    expect(Array.isArray(result.options.strippedProperties)).toBe(true);
    expect(result.options.strippedProperties).toEqual([]);
  });

  it("rebuilds options from the preset table for non-custom presets", () => {
    const result = normalizePasteCleanup({
      preset: "matchBook",
      options: {},
      rules: [],
    });
    expect(result.options).toEqual(PASTE_CLEANUP_PRESETS.matchBook);
  });

  it("coerces a custom-preset options object field by field", () => {
    const result = normalizePasteCleanup({
      preset: "custom",
      options: { demoteHeadings: true, strippedProperties: ["color", 5, "font-size"] },
      rules: [],
    });
    expect(result.options.demoteHeadings).toBe(true);
    expect(result.options.unwrapFormattingTags).toBe(false);
    expect(result.options.strippedProperties).toEqual(["color", "font-size"]);
  });

  it("falls back to keepAll for undefined or malformed input", () => {
    expect(normalizePasteCleanup(undefined).preset).toBe("keepAll");
    expect(normalizePasteCleanup("garbage").preset).toBe("keepAll");
    expect(
      normalizePasteCleanup({ preset: "custom", options: null }).options
        .strippedProperties,
    ).toEqual([]);
  });

  it("drops non-array or malformed rules", () => {
    expect(
      normalizePasteCleanup({ preset: "keepAll", rules: "nope" }).rules,
    ).toEqual([]);
    const result = normalizePasteCleanup({
      preset: "keepAll",
      rules: [
        { id: "ok", enabled: true, label: "", target: "tag", value: "x", action: "delete" },
        { bad: true },
      ],
    });
    expect(result.rules).toHaveLength(1);
  });
});
