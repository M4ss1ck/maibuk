/**
 * Echoes' runtime i18n (#451): the tiny catalog lookup and its plural support.
 * A count-bearing key ships `_one` / `_other` forms and resolves through the
 * Plugin's own en/es plural rule, so a count of one never reads "1 words".
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { compileTemplate, format, pluralCategory, translate } from "./i18n";

describe("translate() plurals", () => {
  it("reads the singular form for one and the plural otherwise, in en and es", () => {
    expect(translate("en", "echo.label.nearbyEarlier", 1)).toBe(
      "{{word}}, repeated {{count}} word earlier"
    );
    expect(translate("en", "echo.label.nearbyEarlier", 2)).toBe(
      "{{word}}, repeated {{count}} words earlier"
    );
    expect(translate("en", "echo.label.overused", 1)).toBe("{{word}}, used {{count}} time");
    expect(translate("en", "echo.label.overused", 5)).toBe("{{word}}, used {{count}} times");
    expect(translate("es", "echo.label.nearbyLater", 1)).toBe(
      "{{word}}, se repite {{count}} palabra después"
    );
    expect(translate("es", "echo.label.nearbyLater", 3)).toBe(
      "{{word}}, se repite {{count}} palabras después"
    );
    expect(translate("es", "report.summary", 1)).toBe("{{count}} vez · {{chapters}}");
    expect(translate("es", "report.summary", 2)).toBe("{{count}} veces · {{chapters}}");
  });

  it("selects the plural category for a count", () => {
    expect(pluralCategory("en", 1)).toBe("one");
    expect(pluralCategory("en", 2)).toBe("other");
    expect(pluralCategory("es", 1)).toBe("one");
    expect(pluralCategory("es", 0)).toBe("other");
  });

  it("leaves a string without a count untouched, with or without one passed", () => {
    expect(translate("en", "echo.highlightsOff")).toBe("Echo highlights are off");
    expect(translate("en", "echo.highlightsOff", 1)).toBe("Echo highlights are off");
    expect(translate("en", "echo.none")).toBe("No echoes found");
  });

  it("fills the placeholders after picking the form", () => {
    expect(format(translate("en", "echo.label.overused", 1), { word: "door", count: 1 })).toBe(
      "door, used 1 time"
    );
    expect(format(translate("es", "echo.label.phrase", 2), { word: "la casa", count: 2 })).toBe(
      '"la casa", se repite 2 veces'
    );
  });
});

describe("pluralCategory() without Intl (#517)", () => {
  // The Android QuickJS global set has no Intl, so Echoes ships its own en/es
  // CLDR rules. Each case stubs Intl away and loads a fresh module, so no cached
  // value or earlier Intl call can stand in for the rule.
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  async function freshI18n() {
    vi.stubGlobal("Intl", undefined);
    vi.resetModules();
    return import("./i18n");
  }

  it("selects one for 1 and other otherwise in en", async () => {
    const i18n = await freshI18n();
    expect(i18n.pluralCategory("en", 1)).toBe("one");
    expect(i18n.pluralCategory("en", 0)).toBe("other");
    expect(i18n.pluralCategory("en", 2)).toBe("other");
    expect(i18n.pluralCategory("en", 14)).toBe("other");
    expect(i18n.pluralCategory("en", 1.5)).toBe("other");
    expect(i18n.pluralCategory("en", -1)).toBe("one");
  });

  it("selects one for 1 and other otherwise in es", async () => {
    const i18n = await freshI18n();
    expect(i18n.pluralCategory("es", 1)).toBe("one");
    expect(i18n.pluralCategory("es", 0)).toBe("other");
    expect(i18n.pluralCategory("es", 2)).toBe("other");
    expect(i18n.pluralCategory("es", 1.5)).toBe("other");
  });

  it("reads one for 1000000 in es as other, since no shipped key has a many form", async () => {
    const i18n = await freshI18n();
    expect(i18n.pluralCategory("es", 1_000_000)).toBe("other");
    expect(i18n.translate("es", "report.summary", 1_000_000)).toBe(
      "{{count}} veces · {{chapters}}"
    );
  });

  it("follows the base subtag, so es-MX and en-US use the same rules", async () => {
    const i18n = await freshI18n();
    expect(i18n.pluralCategory("es-MX", 1)).toBe("one");
    expect(i18n.pluralCategory("en-US", 2)).toBe("other");
  });

  it("matches Intl.PluralRules for en and es over a range of counts, with Intl stubbed off", async () => {
    // Intl is read here, before the stub, to build the expected categories.
    const counts = [-3, -1, 0, 1, 2, 3, 5, 11, 21, 100, 1000, 1.5, 2.25];
    const expected = counts.flatMap((count) =>
      (["en", "es"] as const).map((language) => ({
        language,
        count,
        category: new Intl.PluralRules(language).select(count),
      }))
    );
    const i18n = await freshI18n();
    for (const row of expected) {
      expect(i18n.pluralCategory(row.language, row.count), `${row.language} ${row.count}`).toBe(
        row.category
      );
    }
  });
});

describe("compileTemplate()", () => {
  it("fills the same placeholders format() does, and fills an unknown one empty", () => {
    const fill = compileTemplate("{{word}}, repeated {{count}} words {{missing}}earlier");
    expect(fill({ word: "door", count: 14 })).toBe("door, repeated 14 words earlier");
    expect(fill({ word: "door", count: 1 })).toBe("door, repeated 1 words earlier");
  });

  it("returns one compiler per source, so a repeated template is not recompiled", () => {
    expect(compileTemplate("{{count}} times")).toBe(compileTemplate("{{count}} times"));
  });

  it("handles a template with no placeholder and a repeated name", () => {
    expect(compileTemplate("No echoes found")({})).toBe("No echoes found");
    expect(compileTemplate("{{a}}-{{a}}")({ a: "x" })).toBe("x-x");
  });
});

describe("the color switch label (#532)", () => {
  it("is named in English and Spanish", () => {
    expect(translate("en", "settings.editor.color")).toBe("Color highlights by echo");
    expect(translate("es", "settings.editor.color")).toBe("Colorear resaltados por eco");
  });
});
