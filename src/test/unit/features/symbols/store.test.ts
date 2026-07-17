import { beforeEach, describe, expect, it } from "vitest";
import { MAX_RECENT_SYMBOLS, useSymbolsStore } from "@/features/symbols/store";

describe("useSymbolsStore recents", () => {
  beforeEach(() => {
    useSymbolsStore.setState({ recentGlyphs: [] });
  });

  it("prepends newly used glyphs", () => {
    useSymbolsStore.getState().addRecentGlyph("—");
    useSymbolsStore.getState().addRecentGlyph("†");
    expect(useSymbolsStore.getState().recentGlyphs).toEqual(["†", "—"]);
  });

  it("dedupes, moving a reused glyph to the front", () => {
    useSymbolsStore.getState().addRecentGlyph("—");
    useSymbolsStore.getState().addRecentGlyph("†");
    useSymbolsStore.getState().addRecentGlyph("—");
    expect(useSymbolsStore.getState().recentGlyphs).toEqual(["—", "†"]);
  });

  it(`caps at ${MAX_RECENT_SYMBOLS}`, () => {
    for (let i = 0; i < MAX_RECENT_SYMBOLS + 5; i++) {
      useSymbolsStore.getState().addRecentGlyph(String.fromCodePoint(0x2600 + i));
    }
    expect(useSymbolsStore.getState().recentGlyphs).toHaveLength(MAX_RECENT_SYMBOLS);
  });

  it("persists under the maibuk-symbols key", () => {
    useSymbolsStore.getState().addRecentGlyph("—");
    expect(localStorage.getItem("maibuk-symbols")).toContain("—");
  });
});
