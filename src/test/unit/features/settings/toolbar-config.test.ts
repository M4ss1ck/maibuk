import { describe, expect, it } from "vitest";
import {
  ALL_GROUP_IDS,
  DEFAULT_TOOLBAR_CONFIG,
  FLOATING_ELIGIBLE_IDS,
  addDivider,
  deriveFloatingGroupIds,
  moveEntry,
  moveEntryTo,
  normalizeToolbarConfig,
  removeDivider,
  resetToolbarConfig,
  setGroupFloatingVisible,
  setGroupToolbarVisible,
  suppressOrphanDividers,
  transferEntry,
  type ToolbarConfig,
  type ToolbarEntry,
} from "@/features/settings/toolbar-config";

const groupIds = (entries: ToolbarEntry[]) =>
  entries
    .filter(
      (e): e is Extract<ToolbarEntry, { kind: "group" }> =>
        e.kind === "group",
    )
    .map((e) => e.id);

describe("DEFAULT_TOOLBAR_CONFIG", () => {
  it("contains every configurable group exactly once across both lanes", () => {
    const ids = [
      ...groupIds(DEFAULT_TOOLBAR_CONFIG.start),
      ...groupIds(DEFAULT_TOOLBAR_CONFIG.end),
    ].sort();
    expect(ids).toEqual([...ALL_GROUP_IDS].sort());
    expect(new Set(ids).size).toBe(ALL_GROUP_IDS.length);
  });
  it("puts all groups in Start by default with an empty End", () => {
    expect(groupIds(DEFAULT_TOOLBAR_CONFIG.end)).toEqual([]);
  });
  it("defaults floating-eligible groups to floatingVisible", () => {
    for (const entry of DEFAULT_TOOLBAR_CONFIG.start) {
      if (entry.kind !== "group") continue;
      expect(entry.floatingVisible).toBe(FLOATING_ELIGIBLE_IDS.has(entry.id));
    }
  });
  it("has the exact semantic divider boundaries and is deeply frozen", () => {
    expect(
      DEFAULT_TOOLBAR_CONFIG.start.map((entry) =>
        entry.kind === "divider" ? "D" : entry.id,
      ),
    ).toEqual([
      "history", "D", "font", "D", "basic-marks", "D", "headings", "D",
      "find", "D", "line-height", "D", "highlight", "script", "text-color",
      "link-code", "D", "lists", "blockquote", "D", "indent", "D", "align",
      "D", "clear-formatting", "D", "text-case", "D", "table", "image",
      "scene-break", "footnote", "D", "horizontal-rule", "spellcheck",
      "dictionary", "html-view", "D", "export",
    ]);
    expect(Object.isFrozen(DEFAULT_TOOLBAR_CONFIG)).toBe(true);
    expect(Object.isFrozen(DEFAULT_TOOLBAR_CONFIG.start)).toBe(true);
    expect(Object.isFrozen(DEFAULT_TOOLBAR_CONFIG.end)).toBe(true);
    expect(
      DEFAULT_TOOLBAR_CONFIG.start.every((entry) => Object.isFrozen(entry)),
    ).toBe(true);
  });
});

describe("normalizeToolbarConfig", () => {
  it("returns a deep clone of the default for null/garbage input", () => {
    for (const bad of [null, undefined, 42, "x", {}, { start: 1, end: 2 }]) {
      const result = normalizeToolbarConfig(bad);
      expect(groupIds([...result.start, ...result.end]).sort()).toEqual(
        [...ALL_GROUP_IDS].sort(),
      );
      expect(
        result.start.map((entry) =>
          entry.kind === "divider" ? "D" : entry.id,
        ),
      ).toEqual(
        DEFAULT_TOOLBAR_CONFIG.start.map((entry) =>
          entry.kind === "divider" ? "D" : entry.id,
        ),
      );
      expect(result.start).not.toBe(DEFAULT_TOOLBAR_CONFIG.start);
      expect(result.start[0]).not.toBe(DEFAULT_TOOLBAR_CONFIG.start[0]);
    }
  });
  it("drops duplicate and unknown group ids and appends missing groups with defaults", () => {
    const partial = {
      start: [
        {
          kind: "group",
          id: "basic-marks",
          toolbarVisible: true,
          floatingVisible: true,
        },
        {
          kind: "group",
          id: "basic-marks",
          toolbarVisible: false,
          floatingVisible: false,
        },
        {
          kind: "group",
          id: "not-a-real-group",
          toolbarVisible: true,
          floatingVisible: true,
        },
      ],
      end: [],
    };
    const result = normalizeToolbarConfig(partial);
    const ids = groupIds([...result.start, ...result.end]);
    expect(ids.filter((id) => id === "basic-marks")).toHaveLength(1);
    expect(ids).not.toContain("not-a-real-group");
    expect(ids.sort()).toEqual([...ALL_GROUP_IDS].sort());
    const marks = result.start.find(
      (e) => e.kind === "group" && e.id === "basic-marks",
    );
    expect(marks).toMatchObject({
      toolbarVisible: true,
      floatingVisible: true,
    });
  });
  it("preserves valid user order, flags, and dividers; drops duplicate divider ids", () => {
    const custom = {
      start: [
        { kind: "divider", id: "d1" },
        {
          kind: "group",
          id: "history",
          toolbarVisible: false,
          floatingVisible: false,
        },
      ],
      end: [{ kind: "divider", id: "d1" }],
    };
    const result = normalizeToolbarConfig(custom);
    const dividerIds = [...result.start, ...result.end]
      .filter((e) => e.kind === "divider")
      .map((e) => e.id);
    expect(new Set(dividerIds).size).toBe(dividerIds.length);
    expect(result.start[0]).toEqual({ kind: "divider", id: "d1" });
    expect(
      result.start.find((e) => e.kind === "group" && e.id === "history"),
    ).toMatchObject({ toolbarVisible: false });
  });
  it("drops blank divider ids and defaults malformed group flags", () => {
    const result = normalizeToolbarConfig({
      start: [
        { kind: "divider", id: "" },
        { kind: "divider", id: "   " },
        {
          kind: "group",
          id: "basic-marks",
          toolbarVisible: "no",
          floatingVisible: "no",
        },
      ],
      end: [],
    });
    expect(result.start.some((entry) => entry.kind === "divider")).toBe(false);
    expect(
      result.start.find(
        (entry) => entry.kind === "group" && entry.id === "basic-marks",
      ),
    ).toMatchObject({ toolbarVisible: true, floatingVisible: true });
  });
});

describe("mutation helpers are immutable", () => {
  it("moveEntry does not mutate input and no-ops at boundaries", () => {
    const before: ToolbarConfig = {
      start: [
        {
          kind: "group",
          id: "history",
          toolbarVisible: true,
          floatingVisible: false,
        },
        {
          kind: "group",
          id: "font",
          toolbarVisible: true,
          floatingVisible: false,
        },
      ],
      end: [],
    };
    const snapshot = JSON.stringify(before);
    const moved = moveEntry(before, "start", 1, "up");
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(groupIds(moved.start)).toEqual(["font", "history"]);
    expect(moveEntry(before, "start", 0, "up")).toBe(before);
  });
  it("transferEntry moves a group across sections", () => {
    const before: ToolbarConfig = {
      start: [
        {
          kind: "group",
          id: "history",
          toolbarVisible: true,
          floatingVisible: false,
        },
      ],
      end: [],
    };
    const after = transferEntry(before, "start", 0);
    expect(groupIds(after.start)).toEqual([]);
    expect(groupIds(after.end)).toEqual(["history"]);
  });
  it("addDivider generates a unique id and removeDivider deletes it", () => {
    const withDivider = addDivider(DEFAULT_TOOLBAR_CONFIG, "end");
    const added = withDivider.end.find((e) => e.kind === "divider")!;
    expect(added.kind).toBe("divider");
    const removed = removeDivider(
      withDivider,
      "end",
      (added as { id: string }).id,
    );
    expect(removed.end.some((e) => e.kind === "divider")).toBe(false);
  });
  it("moveEntry supports down and returns the same ref out of range", () => {
    const before: ToolbarConfig = {
      start: [
        { kind: "group", id: "history", toolbarVisible: true, floatingVisible: false },
        { kind: "group", id: "font", toolbarVisible: true, floatingVisible: false },
      ],
      end: [],
    };
    expect(groupIds(moveEntry(before, "start", 0, "down").start)).toEqual([
      "font",
      "history",
    ]);
    expect(moveEntry(before, "start", 2, "down")).toBe(before);
    expect(moveEntry(before, "start", -1, "up")).toBe(before);
  });
  it("moveEntryTo reorders and transfers with clamped insertion indices", () => {
    const before: ToolbarConfig = {
      start: [
        { kind: "group", id: "history", toolbarVisible: true, floatingVisible: false },
        { kind: "group", id: "font", toolbarVisible: true, floatingVisible: false },
      ],
      end: [
        { kind: "group", id: "find", toolbarVisible: true, floatingVisible: false },
      ],
    };
    expect(groupIds(moveEntryTo(before, "start", 0, "start", 99).start)).toEqual([
      "font",
      "history",
    ]);
    const transferred = moveEntryTo(before, "start", 1, "end", -10);
    expect(groupIds(transferred.start)).toEqual(["history"]);
    expect(groupIds(transferred.end)).toEqual(["font", "find"]);
    expect(moveEntryTo(before, "start", 99, "end", 0)).toBe(before);
  });
  it("sets toolbar and eligible floating visibility and no-ops for ineligible floating groups", () => {
    const toolbarHidden = setGroupToolbarVisible(
      DEFAULT_TOOLBAR_CONFIG,
      "history",
      false,
    );
    expect(
      toolbarHidden.start.find(
        (entry) => entry.kind === "group" && entry.id === "history",
      ),
    ).toMatchObject({ toolbarVisible: false });
    const floatingHidden = setGroupFloatingVisible(
      DEFAULT_TOOLBAR_CONFIG,
      "basic-marks",
      false,
    );
    expect(
      floatingHidden.start.find(
        (entry) => entry.kind === "group" && entry.id === "basic-marks",
      ),
    ).toMatchObject({ floatingVisible: false });
    expect(
      setGroupFloatingVisible(DEFAULT_TOOLBAR_CONFIG, "history", true),
    ).toBe(DEFAULT_TOOLBAR_CONFIG);
  });
  it("inserts dividers at clamped positions and remove-missing is a no-op", () => {
    const before: ToolbarConfig = {
      start: [
        { kind: "group", id: "history", toolbarVisible: true, floatingVisible: false },
      ],
      end: [],
    };
    expect(addDivider(before, "start", -10).start[0].kind).toBe("divider");
    expect(addDivider(before, "start", 99).start[1].kind).toBe("divider");
    expect(removeDivider(before, "start", "missing")).toBe(before);
  });
  it("generates unique divider ids", () => {
    const ids = Array.from({ length: 20 }, () =>
      (addDivider({ start: [], end: [] }, "start").start[0] as { id: string }).id,
    );
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("floating derivation & orphan suppression", () => {
  it("deriveFloatingGroupIds returns Start-then-End order, eligible + visible only, ignoring dividers", () => {
    const config = setGroupFloatingVisible(
      DEFAULT_TOOLBAR_CONFIG,
      "headings",
      false,
    );
    const ids = deriveFloatingGroupIds(config);
    expect(ids).not.toContain("headings");
    expect(ids).toContain("basic-marks");
    expect(ids.every((id) => FLOATING_ELIGIBLE_IDS.has(id))).toBe(true);
  });
  it("suppressOrphanDividers removes leading/trailing/consecutive dividers without touching groups", () => {
    const entries: ToolbarEntry[] = [
      { kind: "divider", id: "a" },
      {
        kind: "group",
        id: "history",
        toolbarVisible: true,
        floatingVisible: false,
      },
      { kind: "divider", id: "b" },
      { kind: "divider", id: "c" },
      {
        kind: "group",
        id: "font",
        toolbarVisible: true,
        floatingVisible: false,
      },
      { kind: "divider", id: "d" },
    ];
    const result = suppressOrphanDividers(entries);
    expect(result.map((e) => (e.kind === "divider" ? "|" : e.id))).toEqual([
      "history",
      "|",
      "font",
    ]);
  });
});

describe("resetToolbarConfig", () => {
  it("returns the semantic default with fresh, unique divider ids", () => {
    const firstReset = resetToolbarConfig();
    const secondReset = resetToolbarConfig();
    const layout = (config: ToolbarConfig) =>
      config.start.map((entry) =>
        entry.kind === "divider"
          ? "D"
          : {
              id: entry.id,
              toolbarVisible: entry.toolbarVisible,
              floatingVisible: entry.floatingVisible,
            },
      );
    const dividerIds = (config: ToolbarConfig) =>
      config.start
        .filter((entry) => entry.kind === "divider")
        .map((entry) => entry.id);

    expect(layout(firstReset)).toEqual(layout(DEFAULT_TOOLBAR_CONFIG));
    expect(firstReset.end).toEqual([]);
    expect(firstReset).not.toBe(DEFAULT_TOOLBAR_CONFIG);
    expect(dividerIds(firstReset)).not.toEqual(
      dividerIds(DEFAULT_TOOLBAR_CONFIG),
    );
    expect(dividerIds(secondReset)).not.toEqual(dividerIds(firstReset));
    expect(new Set(dividerIds(firstReset)).size).toBe(
      dividerIds(firstReset).length,
    );
  });
});
