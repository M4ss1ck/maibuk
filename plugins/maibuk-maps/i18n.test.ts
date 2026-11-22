/**
 * Maps' runtime strings: the medium date the Maps list writes, which falls
 * back to the catalogs where the engine has no `Intl` (the Android QuickJS
 * engine), and must read exactly as `Intl` writes it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mediumDate } from "./i18n";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mediumDate()", () => {
  it.each(["en", "es"])("writes every month as Intl does in %s, without Intl", (language) => {
    const intl = new Intl.DateTimeFormat(language, { dateStyle: "medium" });
    const expected = Array.from({ length: 12 }, (_, month) =>
      intl.format(new Date(2026, month, 5, 12).getTime())
    );
    vi.stubGlobal("Intl", undefined);
    const written = Array.from({ length: 12 }, (_, month) =>
      mediumDate(language, new Date(2026, month, 5, 12).getTime())
    );
    expect(written).toEqual(expected);
  });
});
