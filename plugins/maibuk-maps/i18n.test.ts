/**
 * Maps' runtime strings: the medium date the Maps list writes, in the
 * author's language, exactly as `Intl` writes it.
 */
import { describe, expect, it } from "vitest";
import { mediumDate } from "./i18n";

describe("mediumDate()", () => {
  it.each([
    ["en", "Mar 5, 2026"],
    ["es", "5 mar 2026"],
  ])("writes the medium date in %s", (language, expected) => {
    expect(mediumDate(language, new Date(2026, 2, 5, 12).getTime())).toBe(expected);
  });
});
