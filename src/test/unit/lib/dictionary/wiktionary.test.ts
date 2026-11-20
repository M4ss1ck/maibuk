// @vitest-environment jsdom
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

describe("lookupWord() media", () => {
  // Trimmed from the real parse output for "thickness": Wiktionary serves
  // media with protocol-relative URLs, which resolve against the app's own
  // origin (tauri://thumb.wikimedia.org on desktop) and never load.
  const thicknessHtml = `<div class="mw-parser-output">
    <figure><img src="//thumb.wikimedia.org/wikipedia/commons/thumb/3/36/Pick_thickness.jpg/250px-Pick_thickness.jpg?utm_source=en.wiktionary.org" srcset="//thumb.wikimedia.org/wikipedia/commons/thumb/3/36/Pick_thickness.jpg/500px-Pick_thickness.jpg 1.5x, //thumb.wikimedia.org/wikipedia/commons/thumb/3/36/Pick_thickness.jpg/750px-Pick_thickness.jpg 2x" width="250" height="389"></figure>
    <audio controls preload="none"><source src="//upload.wikimedia.org/wikipedia/commons/transcoded/e/eb/thickness.wav.ogg" type="audio/ogg"></audio>
  </div>`;

  async function lookupThickness() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ parse: { text: thicknessHtml } }) }))
    );
    const html = await lookupWord("thickness", "en");
    return new DOMParser().parseFromString(html ?? "", "text/html");
  }

  it("gives every image an absolute https src", async () => {
    const doc = await lookupThickness();
    const img = doc.querySelector("img");
    expect(img?.getAttribute("src")).toBe(
      "https://thumb.wikimedia.org/wikipedia/commons/thumb/3/36/Pick_thickness.jpg/250px-Pick_thickness.jpg?utm_source=en.wiktionary.org"
    );
  });

  it("gives every srcset candidate an absolute https URL and keeps its descriptor", async () => {
    const doc = await lookupThickness();
    expect(doc.querySelector("img")?.getAttribute("srcset")).toBe(
      "https://thumb.wikimedia.org/wikipedia/commons/thumb/3/36/Pick_thickness.jpg/500px-Pick_thickness.jpg 1.5x, https://thumb.wikimedia.org/wikipedia/commons/thumb/3/36/Pick_thickness.jpg/750px-Pick_thickness.jpg 2x"
    );
  });

  it("gives pronunciation audio sources an absolute https src", async () => {
    const doc = await lookupThickness();
    expect(doc.querySelector("source")?.getAttribute("src")).toBe(
      "https://upload.wikimedia.org/wikipedia/commons/transcoded/e/eb/thickness.wav.ogg"
    );
  });
});
