import { describe, expect, it } from "vitest";
import {
  INITIAL_OUTLINE_PIN,
  buildOutline,
  firstStartingInView,
  reduceOutlinePin,
  type OutlinePin,
} from "@/features/settings/outline";
import type { SettingsSectionDef } from "@/features/settings/rows";

const SECTIONS: SettingsSectionDef[] = [
  {
    id: "appearance",
    labelKey: "Appearance",
    rows: [
      { id: "theme", labelKey: "Theme" },
      { id: "fontSize", labelKey: "Font Size" },
    ],
  },
  {
    id: "general",
    labelKey: "General",
    rows: [
      { id: "autoSave", labelKey: "Auto-save" },
      { id: "alwaysOnTop", labelKey: "Always on top", platforms: ["desktop"] },
    ],
  },
  { id: "metrics", labelKey: "Métricas", rows: [{ id: "writing", labelKey: "Volumen" }] },
  { id: "window", labelKey: "Window", rows: [{ id: "tray", labelKey: "Close to tray" }] },
];

const base = {
  present: ["appearance", "general", "metrics"],
  platform: "web" as const,
  translate: (key: string) => key,
  query: "",
  openSection: null as string | null,
};

describe("buildOutline()", () => {
  it("lists only the sections the screen renders, with rows on this platform", () => {
    const outline = buildOutline(SECTIONS, base);
    expect(outline.map((s) => s.id)).toEqual(["appearance", "general", "metrics"]);
    expect(outline[1].rows.map((r) => r.id)).toEqual(["autoSave"]);
  });

  it("opens only the current section when nothing is searched", () => {
    const outline = buildOutline(SECTIONS, { ...base, openSection: "general" });
    expect(outline.map((s) => s.open)).toEqual([false, true, false]);
  });

  it("keeps every row of a section whose name matches", () => {
    const outline = buildOutline(SECTIONS, { ...base, query: "appear" });
    expect(outline).toEqual([
      {
        id: "appearance",
        label: "Appearance",
        rows: [
          { id: "theme", label: "Theme" },
          { id: "fontSize", label: "Font Size" },
        ],
        open: true,
      },
    ]);
  });

  it("keeps only the matching rows of a section matched by a row", () => {
    const outline = buildOutline(SECTIONS, { ...base, query: "SIZE" });
    expect(outline.map((s) => [s.id, s.rows.map((r) => r.id), s.open])).toEqual([
      ["appearance", ["fontSize"], true],
    ]);
  });

  it("ignores accents and case", () => {
    expect(buildOutline(SECTIONS, { ...base, query: "metricas" }).map((s) => s.id)).toEqual([
      "metrics",
    ]);
    expect(buildOutline(SECTIONS, { ...base, query: "VOLUMEN" }).map((s) => s.id)).toEqual([
      "metrics",
    ]);
  });

  it("returns nothing when nothing matches, and treats blank queries as none", () => {
    expect(buildOutline(SECTIONS, { ...base, query: "zzz" })).toEqual([]);
    expect(buildOutline(SECTIONS, { ...base, query: "   " })).toHaveLength(3);
  });
});

describe("firstStartingInView()", () => {
  const tops: Record<string, number | null> = {};
  const topOf = (id: string) => tops[id] ?? null;

  it("picks the first item whose top is inside the view", () => {
    Object.assign(tops, { a: -400, b: 120, c: 500 });
    expect(firstStartingInView(["a", "b", "c"], topOf, 0, 800)).toBe("b");
  });

  it("falls back to the item covering the top when none starts in view", () => {
    Object.assign(tops, { a: -900, b: -300, c: 1200 });
    expect(firstStartingInView(["a", "b", "c"], topOf, 0, 800)).toBe("b");
  });

  it("measures from below a sticky bar", () => {
    Object.assign(tops, { a: -10, b: 30, c: 60 });
    expect(firstStartingInView(["a", "b", "c"], topOf, 46, 800)).toBe("c");
  });

  it("accepts a top a fraction of a pixel above the view", () => {
    Object.assign(tops, { a: -500, b: -0.5, c: 300 });
    expect(firstStartingInView(["a", "b", "c"], topOf, 0, 800)).toBe("b");
  });

  it("skips items without a top and returns null for none", () => {
    expect(firstStartingInView(["x", "y"], () => null, 0, 800)).toBeNull();
    expect(firstStartingInView([], topOf, 0, 800)).toBeNull();
  });
});

describe("reduceOutlinePin()", () => {
  const selection = { section: "editor", row: null };

  it("pins a clicked entry through the scroll its jump causes", () => {
    let state: OutlinePin = reduceOutlinePin(INITIAL_OUTLINE_PIN, { type: "jump", selection });
    state = reduceOutlinePin(state, { type: "scroll" });
    state = reduceOutlinePin(state, { type: "scroll" });
    expect(state).toEqual({ pinned: selection, jumping: true });
  });

  it("hands control back to the spy on the first scroll after the jump settles", () => {
    let state = reduceOutlinePin(INITIAL_OUTLINE_PIN, { type: "jump", selection });
    state = reduceOutlinePin(state, { type: "settled" });
    expect(state).toEqual({ pinned: selection, jumping: false });
    expect(reduceOutlinePin(state, { type: "scroll" })).toEqual(INITIAL_OUTLINE_PIN);
  });

  it("keeps a pin while nothing scrolls", () => {
    const state = reduceOutlinePin(
      reduceOutlinePin(INITIAL_OUTLINE_PIN, { type: "jump", selection }),
      { type: "settled" }
    );
    expect(reduceOutlinePin(state, { type: "settled" })).toBe(state);
  });

  it("leaves the spy in charge when nothing is pinned", () => {
    expect(reduceOutlinePin(INITIAL_OUTLINE_PIN, { type: "scroll" })).toBe(INITIAL_OUTLINE_PIN);
    expect(reduceOutlinePin(INITIAL_OUTLINE_PIN, { type: "settled" })).toBe(INITIAL_OUTLINE_PIN);
  });

  it("lets a second click replace the first pin", () => {
    const other = { section: "sync", row: "syncNow" };
    const state = reduceOutlinePin(
      reduceOutlinePin(INITIAL_OUTLINE_PIN, { type: "jump", selection }),
      { type: "jump", selection: other }
    );
    expect(state.pinned).toEqual(other);
  });
});
