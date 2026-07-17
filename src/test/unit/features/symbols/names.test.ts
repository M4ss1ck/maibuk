// src/test/unit/features/symbols/names.test.ts
import { describe, expect, it } from "vitest";
import { formatCodePoint, hangulSyllableName, rangeCharName } from "@/features/symbols/names";

describe("formatCodePoint", () => {
  it("pads to 4 hex digits, uppercase", () => {
    expect(formatCodePoint(0x2014)).toBe("U+2014");
    expect(formatCodePoint(0x41)).toBe("U+0041");
    expect(formatCodePoint(0x1f600)).toBe("U+1F600");
  });
});

describe("hangulSyllableName", () => {
  it("derives the standard algorithmic name", () => {
    expect(hangulSyllableName(0xac00)).toBe("HANGUL SYLLABLE GA");
    expect(hangulSyllableName(0xd7a3)).toBe("HANGUL SYLLABLE HIH");
  });
});

describe("rangeCharName", () => {
  it("formats prefix ranges with hex suffix", () => {
    expect(rangeCharName(0x4e00, "CJK UNIFIED IDEOGRAPH")).toBe("CJK UNIFIED IDEOGRAPH-4E00");
  });
  it("uses the Hangul algorithm for the HANGUL sentinel", () => {
    expect(rangeCharName(0xac00, "HANGUL")).toBe("HANGUL SYLLABLE GA");
  });
});
