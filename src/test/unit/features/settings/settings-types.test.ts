import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRIMARY_COLOR,
  FONT_SIZE_OPTIONS,
  FONT_OPTIONS,
  EXPORT_FORMAT_OPTIONS,
  LANGUAGE_OPTIONS,
} from "../../../../features/settings/types";

describe("DEFAULT_PRIMARY_COLOR", () => {
  it("is a valid hex color", () => {
    expect(DEFAULT_PRIMARY_COLOR).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});

describe("FONT_SIZE_OPTIONS", () => {
  it("has at least 3 options", () => {
    expect(FONT_SIZE_OPTIONS.length).toBeGreaterThanOrEqual(3);
  });

  it("values are ascending", () => {
    for (let i = 1; i < FONT_SIZE_OPTIONS.length; i++) {
      expect(FONT_SIZE_OPTIONS[i].value).toBeGreaterThan(
        FONT_SIZE_OPTIONS[i - 1].value,
      );
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
