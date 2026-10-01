import { describe, expect, it } from "vitest";
import en from "@/locales/en.json";
import es from "@/locales/es.json";
import {
  SETTINGS_SECTIONS,
  findSettingsRow,
} from "@/components/settings/settings-sections";
import { rowOnPlatform, type SettingsRowDef } from "@/features/settings/rows";
import { SETTINGS_KEY_ROWS } from "@/features/settings/settings-rows-keys";

function lookup(locale: Record<string, unknown>, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => {
    if (typeof node !== "object" || node === null) return undefined;
    return (node as Record<string, unknown>)[part];
  }, locale);
}

function allRows(): SettingsRowDef[] {
  return SETTINGS_SECTIONS.flatMap((section) => [...section.rows]);
}

describe("settings rows", () => {
  it("uses unique camelCase ids across all sections", () => {
    const ids = allRows().map((row) => row.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z][a-zA-Z0-9]*$/);
    }
  });

  it("uses unique section ids", () => {
    const ids = SETTINGS_SECTIONS.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("declares every label, description, and keywords key in both locales", () => {
    for (const row of allRows()) {
      expect(typeof lookup(en, row.labelKey), `${row.id}.labelKey`).toBe("string");
      expect(typeof lookup(es, row.labelKey), `${row.id}.labelKey`).toBe("string");
      if (row.descriptionKey) {
        expect(typeof lookup(en, row.descriptionKey), `${row.id}.descriptionKey`).toBe(
          "string"
        );
        expect(typeof lookup(es, row.descriptionKey), `${row.id}.descriptionKey`).toBe(
          "string"
        );
      }
      if (row.keywordsKey) {
        // Keywords live under settings.keywords.<rowId> as string arrays.
        expect(row.keywordsKey, `${row.id}.keywordsKey`).toBe(`settings.keywords.${row.id}`);
        for (const locale of [en, es]) {
          const keywords = lookup(locale, row.keywordsKey);
          expect(Array.isArray(keywords), `${row.id}.keywords`).toBe(true);
          const terms = keywords as unknown[];
          expect(terms.length).toBeGreaterThan(0);
          for (const term of terms) {
            expect(typeof term).toBe("string");
            expect((term as string).length).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it("finds every row by id and misses unknown ids", () => {
    for (const section of SETTINGS_SECTIONS) {
      for (const row of section.rows) {
        const found = findSettingsRow(row.id);
        expect(found?.section.id).toBe(section.id);
        expect(found?.row.id).toBe(row.id);
      }
    }
    expect(findSettingsRow("noSuchRow")).toBeUndefined();
  });

  it("shows rows on their platforms only", () => {
    const everywhere = { id: "x", labelKey: "settings.title" };
    expect(rowOnPlatform(everywhere, "web")).toBe(true);
    expect(rowOnPlatform(everywhere, "desktop")).toBe(true);
    expect(rowOnPlatform(everywhere, "android")).toBe(true);

    const desktopOnly: SettingsRowDef = { ...everywhere, platforms: ["desktop"] };
    expect(rowOnPlatform(desktopOnly, "web")).toBe(false);
    expect(rowOnPlatform(desktopOnly, "desktop")).toBe(true);
    expect(rowOnPlatform(desktopOnly, "android")).toBe(false);
  });

  it("classifies every Settings store key as a row or internal", () => {
    // tsc already fails on an unclassified key (Record<keyof Settings, ...));
    // this pins the row side to declared rows.
    for (const [key, rowId] of Object.entries(SETTINGS_KEY_ROWS)) {
      if (rowId === "internal") continue;
      expect(findSettingsRow(rowId), key).toBeDefined();
    }
  });
});
