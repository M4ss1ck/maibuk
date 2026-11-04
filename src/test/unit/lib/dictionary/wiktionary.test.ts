import { afterEach, describe, expect, it, vi } from "vitest";

import { lookupWord, wiktionaryOrigin, wiktionaryPageUrl } from "@/lib/dictionary";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("wiktionaryOrigin()", () => {
  it("uses the base language's Wiktionary", () => {
    expect(wiktionaryOrigin("pt-BR")).toBe("https://pt.wiktionary.org");
  });

  it("falls back to English for a tag that is not a language", () => {
    expect(wiktionaryOrigin("evil.com/#")).toBe("https://en.wiktionary.org");
  });
});

describe("wiktionaryPageUrl()", () => {
  it("points at the word's page on the base language's Wiktionary", () => {
    expect(wiktionaryPageUrl("casa", "pt-BR")).toBe("https://pt.wiktionary.org/wiki/casa");
  });

  it("falls back to English for a tag that is not a language", () => {
    expect(wiktionaryPageUrl("casa", "evil.com/#")).toBe("https://en.wiktionary.org/wiki/casa");
  });
});

describe("lookupWord()", () => {
  it("fetches from the base language's Wiktionary", async () => {
    let requested = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        requested = String(input);
        return {
          ok: true,
          json: async () => ({
            parse: { text: "<div class='mw-parser-output'><p>casa</p></div>" },
          }),
        };
      })
    );

    await lookupWord("casa", "pt-BR");

    const url = new URL(requested);
    expect(url.host).toBe("pt.wiktionary.org");
    expect(url.pathname).toBe("/w/api.php");
  });
});
