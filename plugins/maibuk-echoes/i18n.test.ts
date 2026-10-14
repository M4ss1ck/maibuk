/**
 * Echoes' runtime i18n (#451): the tiny catalog lookup and its plural support.
 * A count-bearing key ships `_one` / `_other` forms and resolves through
 * Intl.PluralRules, so a count of one never reads "1 words".
 */

import { describe, expect, it } from "vitest";
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

  it("selects the plural category through Intl.PluralRules", () => {
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
