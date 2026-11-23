/**
 * Echoes' runtime i18n (#451): the tiny catalog lookup and its plural support.
 * A count-bearing key ships `_one` / `_other` forms and resolves through
 * `Intl.PluralRules`, so a count of one never reads "1 words".
 */

import { describe, expect, it } from "vitest";
import { compileTemplate, format, translate } from "./i18n";

describe("translate() plurals", () => {
  it("reads the form Intl.PluralRules selects for a count in en", () => {
    // `report.summary` ships `_one` and `_other`; "one" is the integer 1 in magnitude.
    expect(translate("en", "report.summary", 1)).toBe("{{count}} time · {{chapters}}");
    expect(translate("en", "report.summary", -1)).toBe("{{count}} time · {{chapters}}");
    expect(translate("en", "report.summary", 0)).toBe("{{count}} times · {{chapters}}");
    expect(translate("en", "report.summary", 2)).toBe("{{count}} times · {{chapters}}");
    expect(translate("en", "report.summary", 1.5)).toBe("{{count}} times · {{chapters}}");
  });

  it("reads the form Intl.PluralRules selects for a count in es", () => {
    expect(translate("es", "report.summary", 1)).toBe("{{count}} vez · {{chapters}}");
    expect(translate("es", "report.summary", -1)).toBe("{{count}} vez · {{chapters}}");
    expect(translate("es", "report.summary", 0)).toBe("{{count}} veces · {{chapters}}");
    expect(translate("es", "report.summary", 2)).toBe("{{count}} veces · {{chapters}}");
    expect(translate("es", "report.summary", 1.5)).toBe("{{count}} veces · {{chapters}}");
  });

  it("reads _other when Intl picks a form the catalogs do not ship", () => {
    // Spanish CLDR gives an exact million the "many" category; no key ships `_many`.
    expect(new Intl.PluralRules("es").select(1_000_000)).toBe("many");
    expect(translate("es", "report.summary", 1_000_000)).toBe("{{count}} veces · {{chapters}}");
  });

  it("follows the base subtag, so a regional tag reads its catalog and rule", () => {
    expect(translate("es-MX", "report.summary", 1)).toBe("{{count}} vez · {{chapters}}");
    expect(translate("en-US", "report.summary", 2)).toBe("{{count}} times · {{chapters}}");
  });

  it("reads English with English's rule for a language with no catalog, an empty tag included", () => {
    expect(translate("fr", "report.summary", 1)).toBe("{{count}} time · {{chapters}}");
    expect(translate("", "report.summary", 2)).toBe("{{count}} times · {{chapters}}");
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
