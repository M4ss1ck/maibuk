import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRIMARY_COLOR,
  DEFAULT_TAURI_BACKUP_RETENTION,
  DEFAULT_WEB_BACKUP_RETENTION,
  FONT_SIZE_OPTIONS,
  FONT_OPTIONS,
  EXPORT_FORMAT_OPTIONS,
  LANGUAGE_OPTIONS,
  getDefaultBackupRetention,
  PASTE_CLEANUP_PRESETS,
  PASTE_STRUCTURAL_OPTION_KEYS,
  PASTE_RULE_TARGET_VALUES,
  PASTE_RULE_TARGET_META,
  BOOK_STRIP_PROPERTIES,
  PASTE_STRIP_COMMON_PROPERTIES,
  DEFAULT_EDITOR_CONTENT_WIDTH,
  EDITOR_CONTENT_WIDTH_MIN,
  EDITOR_CONTENT_WIDTH_MAX,
  EDITOR_CONTENT_WIDTH_STEP,
  EDITOR_CONTENT_WIDTH_FULL,
  EDITOR_CONTENT_WIDTH_PRESETS,
  clampEditorContentWidth,
  EDITOR_PAGE_PADDING_MIN,
  EDITOR_PAGE_PADDING_MAX,
  EDITOR_PAGE_PADDING_STEP,
  DEFAULT_EDITOR_PAGE_PADDING,
  clampEditorPagePadding,
} from "../../../../features/settings/types";

describe("DEFAULT_PRIMARY_COLOR", () => {
  it("is a valid hex color", () => {
    expect(DEFAULT_PRIMARY_COLOR).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});

describe("backup retention defaults", () => {
  it("exports the expected platform defaults", () => {
    expect(DEFAULT_TAURI_BACKUP_RETENTION).toBe(20);
    expect(DEFAULT_WEB_BACKUP_RETENTION).toBe(5);
  });

  it("returns the web default when running on web", () => {
    expect(getDefaultBackupRetention(true)).toBe(5);
  });

  it("returns the Tauri default when not running on web", () => {
    expect(getDefaultBackupRetention(false)).toBe(20);
  });
});

describe("FONT_SIZE_OPTIONS", () => {
  it("has at least 3 options", () => {
    expect(FONT_SIZE_OPTIONS.length).toBeGreaterThanOrEqual(3);
  });

  it("values are ascending", () => {
    for (let i = 1; i < FONT_SIZE_OPTIONS.length; i++) {
      expect(FONT_SIZE_OPTIONS[i].value).toBeGreaterThan(FONT_SIZE_OPTIONS[i - 1].value);
    }
  });

  it("every option has a value and label", () => {
    for (const opt of FONT_SIZE_OPTIONS) {
      expect(typeof opt.value).toBe("number");
      expect(typeof opt.label).toBe("string");
      expect(opt.label.length).toBeGreaterThan(0);
    }
  });
});

describe("FONT_OPTIONS", () => {
  it("includes serif, sans, and mono", () => {
    const values = FONT_OPTIONS.map((o) => o.value);
    expect(values).toContain("serif");
    expect(values).toContain("sans");
    expect(values).toContain("mono");
  });
});

describe("EXPORT_FORMAT_OPTIONS", () => {
  it("includes epub and pdf", () => {
    const values = EXPORT_FORMAT_OPTIONS.map((o) => o.value);
    expect(values).toContain("epub");
    expect(values).toContain("pdf");
  });
});

describe("LANGUAGE_OPTIONS", () => {
  it("includes en and es", () => {
    const values = LANGUAGE_OPTIONS.map((o) => o.value);
    expect(values).toContain("en");
    expect(values).toContain("es");
  });

  it("every option has a non-empty label", () => {
    for (const opt of LANGUAGE_OPTIONS) {
      expect(opt.label.length).toBeGreaterThan(0);
    }
  });
});

describe("PASTE_STRUCTURAL_OPTION_KEYS", () => {
  it("has the 5 structural option keys, all boolean on the presets", () => {
    expect(PASTE_STRUCTURAL_OPTION_KEYS).toHaveLength(5);
    for (const key of PASTE_STRUCTURAL_OPTION_KEYS) {
      expect(typeof PASTE_CLEANUP_PRESETS.keepAll[key]).toBe("boolean");
    }
  });
});

describe("PASTE_CLEANUP_PRESETS", () => {
  it("keepAll strips nothing and runs no structural ops", () => {
    expect(PASTE_CLEANUP_PRESETS.keepAll.strippedProperties).toEqual([]);
    for (const key of PASTE_STRUCTURAL_OPTION_KEYS) {
      expect(PASTE_CLEANUP_PRESETS.keepAll[key]).toBe(false);
    }
  });

  it("matchBook strips the book property set with no structural ops", () => {
    expect(PASTE_CLEANUP_PRESETS.matchBook.strippedProperties).toEqual(
      BOOK_STRIP_PROPERTIES,
    );
    for (const key of PASTE_STRUCTURAL_OPTION_KEYS) {
      expect(PASTE_CLEANUP_PRESETS.matchBook[key]).toBe(false);
    }
  });

  it("plainText enables every structural op and strips the most", () => {
    for (const key of PASTE_STRUCTURAL_OPTION_KEYS) {
      expect(PASTE_CLEANUP_PRESETS.plainText[key]).toBe(true);
    }
    for (const prop of BOOK_STRIP_PROPERTIES) {
      expect(PASTE_CLEANUP_PRESETS.plainText.strippedProperties).toContain(prop);
    }
    expect(PASTE_CLEANUP_PRESETS.plainText.strippedProperties).toContain(
      "font-weight",
    );
  });
});

describe("BOOK_STRIP_PROPERTIES", () => {
  it("includes the common book-relevant properties", () => {
    for (const prop of ["color", "font-family", "font-size"]) {
      expect(BOOK_STRIP_PROPERTIES).toContain(prop);
    }
  });
});

describe("PASTE_STRIP_COMMON_PROPERTIES", () => {
  it("is a non-empty list of lowercase CSS property names", () => {
    expect(PASTE_STRIP_COMMON_PROPERTIES.length).toBeGreaterThan(0);
    for (const prop of PASTE_STRIP_COMMON_PROPERTIES) {
      expect(prop).toBe(prop.toLowerCase());
    }
  });
});

describe("PASTE_RULE_TARGET_META", () => {
  it("has a non-empty example for every rule target", () => {
    for (const target of PASTE_RULE_TARGET_VALUES) {
      expect(PASTE_RULE_TARGET_META[target].example.length).toBeGreaterThan(0);
    }
  });
});

describe("clampEditorContentWidth", () => {
  it("returns the default for non-finite input", () => {
    expect(clampEditorContentWidth(Number.NaN)).toBe(DEFAULT_EDITOR_CONTENT_WIDTH);
  });

  it("clamps below the minimum up to the minimum", () => {
    expect(clampEditorContentWidth(100)).toBe(EDITOR_CONTENT_WIDTH_MIN);
  });

  it("clamps above the maximum down to the maximum", () => {
    expect(clampEditorContentWidth(EDITOR_CONTENT_WIDTH_MAX + 500)).toBe(
      EDITOR_CONTENT_WIDTH_MAX,
    );
  });

  it("snaps to the step grid", () => {
    expect(clampEditorContentWidth(731)).toBe(740);
  });

  it("passes the Full sentinel through unchanged", () => {
    expect(clampEditorContentWidth(EDITOR_CONTENT_WIDTH_FULL)).toBe(
      EDITOR_CONTENT_WIDTH_FULL,
    );
  });
});

describe("EDITOR_CONTENT_WIDTH_PRESETS", () => {
  it("default value matches the Comfortable preset", () => {
    const comfortable = EDITOR_CONTENT_WIDTH_PRESETS.find(
      (p) => p.value === DEFAULT_EDITOR_CONTENT_WIDTH,
    );
    expect(comfortable).toBeDefined();
  });

  it("ends with the Full preset", () => {
    const last =
      EDITOR_CONTENT_WIDTH_PRESETS[EDITOR_CONTENT_WIDTH_PRESETS.length - 1];
    expect(last.value).toBe(EDITOR_CONTENT_WIDTH_FULL);
  });

  it("non-Full preset values lie on the step grid", () => {
    for (const preset of EDITOR_CONTENT_WIDTH_PRESETS) {
      if (preset.value === EDITOR_CONTENT_WIDTH_FULL) continue;
      expect(preset.value % EDITOR_CONTENT_WIDTH_STEP).toBe(0);
    }
  });
});

describe("DEFAULT_EDITOR_PAGE_PADDING", () => {
  it("is a multiple of the step and within bounds", () => {
    expect(DEFAULT_EDITOR_PAGE_PADDING % EDITOR_PAGE_PADDING_STEP).toBe(0);
    expect(DEFAULT_EDITOR_PAGE_PADDING).toBeGreaterThanOrEqual(
      EDITOR_PAGE_PADDING_MIN,
    );
    expect(DEFAULT_EDITOR_PAGE_PADDING).toBeLessThanOrEqual(
      EDITOR_PAGE_PADDING_MAX,
    );
  });
});

describe("clampEditorPagePadding", () => {
  it("returns the default for non-finite input", () => {
    expect(clampEditorPagePadding(Number.NaN)).toBe(DEFAULT_EDITOR_PAGE_PADDING);
  });

  it("clamps below the minimum up to the minimum", () => {
    expect(clampEditorPagePadding(-8)).toBe(EDITOR_PAGE_PADDING_MIN);
  });

  it("clamps above the maximum down to the maximum", () => {
    expect(clampEditorPagePadding(EDITOR_PAGE_PADDING_MAX + 8)).toBe(
      EDITOR_PAGE_PADDING_MAX,
    );
  });

  it("snaps to the step grid", () => {
    expect(clampEditorPagePadding(33)).toBe(32);
    expect(clampEditorPagePadding(37)).toBe(40);
  });
});
