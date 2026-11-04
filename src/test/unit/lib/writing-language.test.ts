import { describe, expect, it } from "vitest";

import {
  baseLanguage,
  languageDisplayName,
  resolveWritingLanguage,
  withLanguageOption,
} from "@/lib/writing-language";

describe("baseLanguage()", () => {
  it.each([
    ["es-MX", "es"],
    ["pt_BR", "pt"],
    ["EN", "en"],
    ["es", "es"],
    ["", null],
    [null, null],
    [undefined, null],
    ["evil.com/#", null],
    ["-es", null],
    ["toolongtag", null],
  ])("maps %j to %j", (tag, expected) => {
    expect(baseLanguage(tag)).toBe(expected);
  });
});

describe("resolveWritingLanguage()", () => {
  it("returns the Note's own language first", () => {
    expect(resolveWritingLanguage({ own: "pt-BR", book: "es", app: "en" })).toBe("pt-BR");
  });

  it("falls back to the Book when the Note's own language is blank", () => {
    expect(resolveWritingLanguage({ own: "  ", book: "es-MX", app: "en" })).toBe("es-MX");
  });

  it("falls back to the app language with no Book", () => {
    expect(resolveWritingLanguage({ book: null, app: "es" })).toBe("es");
  });

  it("returns the tag unchanged", () => {
    expect(resolveWritingLanguage({ own: "pt-BR", app: "en" })).toBe("pt-BR");
  });
});

describe("languageDisplayName()", () => {
  it("names a language in its own language", () => {
    expect(languageDisplayName("pt-BR").toLowerCase()).toContain("portugu");
  });

  it("returns a tag it cannot name", () => {
    expect(languageDisplayName("not a tag!")).toBe("not a tag!");
  });
});

describe("withLanguageOption()", () => {
  const options = [
    { value: "en", label: "English" },
    { value: "es", label: "Español" },
  ];

  it("returns the same options when the tag is already offered", () => {
    expect(withLanguageOption(options, "es")).toBe(options);
  });

  it("returns the same options when the tag is blank", () => {
    expect(withLanguageOption(options, " ")).toBe(options);
  });

  it("appends an option for a new tag", () => {
    expect(withLanguageOption(options, "pt-BR")).toEqual([
      ...options,
      { value: "pt-BR", label: languageDisplayName("pt-BR") },
    ]);
  });
});
