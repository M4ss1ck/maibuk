/**
 * The Reader Frame's Find engine (#941), unit-tested in Node: the pure
 * `countMatches` the Page view search counts a page's hits with. The search
 * semantics are the ones the Frame has today, asserted literally: every
 * occurrence counts, case-insensitively, one after another, so an overlapping
 * occurrence is not counted; no whole-word or accent rule applies. The DOM half
 * (`createFind`) stays at the Frame bundle seam, proven by `frame.test.ts` and
 * `frame-books.test.ts`.
 */

import { describe, expect, it } from "vitest";
import { countMatches } from "./find";

describe("countMatches()", () => {
  it("counts nothing for an empty query", () => {
    expect(countMatches("the spice must flow", "")).toBe(0);
    expect(countMatches("", "")).toBe(0);
  });

  it("counts nothing in empty text", () => {
    expect(countMatches("", "spice")).toBe(0);
  });

  it("counts a single occurrence", () => {
    expect(countMatches("the spice must flow", "spice")).toBe(1);
  });

  it("counts every occurrence in a page's text", () => {
    expect(countMatches("spice and spice", "spice")).toBe(2);
    expect(countMatches("spice, spice, and spice", "spice")).toBe(3);
  });

  it("counts case-insensitively", () => {
    expect(countMatches("Spice and SPICE", "spice")).toBe(2);
    expect(countMatches("THE SPICE MUST FLOW", "spice")).toBe(1);
    expect(countMatches("Búsqueda", "BÚSQUEDA")).toBe(1);
  });

  it("advances past each hit, so overlapping occurrences count once", () => {
    expect(countMatches("aaa", "aa")).toBe(1);
    expect(countMatches("aaaa", "aa")).toBe(2);
    expect(countMatches("abababa", "aba")).toBe(2);
  });

  it("does not require whole words", () => {
    expect(countMatches("spices and spiced", "spice")).toBe(2);
    expect(countMatches("thespice", "spice")).toBe(1);
  });

  it("counts nothing when the needle is longer than the text", () => {
    expect(countMatches("spice", "spices")).toBe(0);
    expect(countMatches("a", "ab")).toBe(0);
  });
});
