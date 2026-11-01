import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_TOOLBAR_CONFIG,
  applyToolbarButtonRenames,
  displayedToolbarEntries,
  hideToolbarEntry,
  liveSelectionToolbarIds,
  mergeToolbarDividers,
  normalizeToolbarConfig,
  placeSelectionToolbarEntry,
  placeToolbarEntry,
  registerToolbarButtons,
  removeSelectionToolbarEntry,
  resetToolbarConfig,
  setSelectionToolbarMember,
  toolbarSlotAcceptsDivider,
  withRegisteredToolbarButtons,
  type ToolbarConfig,
  type ToolbarEntry,
} from "@/features/settings/toolbar-config";

const group = (id: string, toolbarVisible = true): ToolbarEntry =>
  ({ kind: "group", id, toolbarVisible }) as ToolbarEntry;
const divider = (id: string): ToolbarEntry => ({ kind: "divider", id });
const ids = (entries: ToolbarEntry[]) => entries.map((entry) => entry.id);

const unregisters: (() => void)[] = [];
afterEach(() => {
  for (const unregister of unregisters.splice(0)) unregister();
});

function config(
  start: ToolbarEntry[],
  end: ToolbarEntry[] = [],
  selectionToolbar: string[] = []
): ToolbarConfig {
  return { start, end, selectionToolbar } as ToolbarConfig;
}

describe("the Selection Toolbar's own order (ADR 0038)", () => {
  it("defaults to today's Selection Toolbar buttons in today's order", () => {
    expect(DEFAULT_TOOLBAR_CONFIG.selectionToolbar).toEqual([
      "basic-marks",
      "headings",
      "highlight",
      "link-code",
    ]);
    expect(resetToolbarConfig().selectionToolbar).toEqual(DEFAULT_TOOLBAR_CONFIG.selectionToolbar);
  });

  it("builds the list on upgrade from the old flags, in the old derived order", () => {
    const upgraded = normalizeToolbarConfig({
      start: [
        { kind: "group", id: "link-code", toolbarVisible: true, floatingVisible: true },
        { kind: "group", id: "basic-marks", toolbarVisible: true, floatingVisible: false },
        { kind: "group", id: "headings", toolbarVisible: false, floatingVisible: true },
      ],
      end: [{ kind: "group", id: "highlight", toolbarVisible: true, floatingVisible: true }],
    });
    expect(upgraded.selectionToolbar).toEqual(["link-code", "headings", "highlight"]);
  });

  it("drops the old flag from every entry once upgraded", () => {
    const upgraded = normalizeToolbarConfig({
      start: [{ kind: "group", id: "history", toolbarVisible: true, floatingVisible: true }],
      end: [],
    });
    expect(upgraded.start[0]).toEqual({ kind: "group", id: "history", toolbarVisible: true });
  });

  it("treats a missing old flag as on, as the old reader did", () => {
    const upgraded = normalizeToolbarConfig({
      start: [{ kind: "group", id: "highlight", toolbarVisible: true }],
      end: [],
    });
    expect(upgraded.selectionToolbar[0]).toBe("highlight");
  });

  it("keeps the slot of a button whose Plugin is missing on upgrade", () => {
    const upgraded = normalizeToolbarConfig({
      start: [
        { kind: "group", id: "plugin.gone.tool", toolbarVisible: true, floatingVisible: true },
        { kind: "group", id: "basic-marks", toolbarVisible: true, floatingVisible: true },
      ],
      end: [],
    });
    expect(upgraded.selectionToolbar.slice(0, 2)).toEqual(["plugin.gone.tool", "basic-marks"]);
    expect(liveSelectionToolbarIds(upgraded)).not.toContain("plugin.gone.tool");
  });

  it("keeps a stored list in the author's order, dropping ineligible, unknown and repeated ids", () => {
    const stored = normalizeToolbarConfig({
      start: [{ kind: "group", id: "basic-marks", toolbarVisible: true }],
      end: [],
      selectionToolbar: ["link-code", "history", "nope", "link-code", "basic-marks"],
    });
    expect(stored.selectionToolbar).toEqual(["link-code", "basic-marks"]);
  });

  it("keeps a stored empty list empty instead of filling defaults", () => {
    expect(
      normalizeToolbarConfig({ start: [], end: [], selectionToolbar: [] }).selectionToolbar
    ).toEqual([]);
  });

  it("adds a newly registered Plugin button to both toolbars, and renames move its slot", () => {
    unregisters.push(registerToolbarButtons("demo", { buttons: [{ id: "first" }] }));
    const withButton = withRegisteredToolbarButtons(config([group("history")], [], ["headings"]));
    expect(withButton.selectionToolbar).toEqual(["headings", "plugin.demo.first"]);

    unregisters.push(
      registerToolbarButtons("demo", {
        buttons: [{ id: "second" }],
        buttonRenames: { first: "second" },
      })
    );
    expect(applyToolbarButtonRenames(withButton).selectionToolbar).toEqual([
      "headings",
      "plugin.demo.second",
    ]);
  });
});

describe("setSelectionToolbarMember (the List switch)", () => {
  const editor = config(
    [group("basic-marks"), group("headings"), group("highlight")],
    [group("link-code")]
  );

  it("inserts after the last Selection Toolbar button that comes before it in the Editor Toolbar", () => {
    const next = setSelectionToolbarMember(
      { ...editor, selectionToolbar: ["link-code", "basic-marks"] },
      "headings",
      true
    );
    expect(next.selectionToolbar).toEqual(["link-code", "basic-marks", "headings"]);
  });

  it("inserts first when no Selection Toolbar button comes before it", () => {
    const next = setSelectionToolbarMember(
      { ...editor, selectionToolbar: ["link-code", "highlight"] },
      "basic-marks",
      true
    );
    expect(next.selectionToolbar).toEqual(["basic-marks", "link-code", "highlight"]);
  });

  it("removes a button and leaves the rest of the author's order alone", () => {
    const next = setSelectionToolbarMember(
      { ...editor, selectionToolbar: ["link-code", "headings", "basic-marks"] },
      "headings",
      false
    );
    expect(next.selectionToolbar).toEqual(["link-code", "basic-marks"]);
  });

  it("refuses a button the Selection Toolbar cannot hold", () => {
    const before = { ...editor, selectionToolbar: [] };
    expect(setSelectionToolbarMember(before, "history", true)).toBe(before);
  });
});

describe("the visual Toolbar layout's moves", () => {
  it("shows what the Editor Toolbar renders: no hidden buttons, no orphan dividers", () => {
    const lane = [
      divider("d0"),
      group("history"),
      group("font", false),
      group("plugin.gone.tool"),
      divider("d1"),
      divider("d2"),
      group("find"),
      divider("d3"),
    ];
    expect(ids(displayedToolbarEntries(lane))).toEqual(["history", "d1", "find"]);
  });

  it("places a button at a shown slot, across Start and End, and shows a hidden one", () => {
    const start = config(
      [group("history"), group("font"), group("find", false)],
      [group("export")]
    );
    expect(
      ids(placeToolbarEntry(start, group("history"), { section: "start", index: 1 }).start)
    ).toEqual(["font", "history", "find"]);
    const toEnd = placeToolbarEntry(start, group("font"), { section: "end", index: 0 });
    expect(ids(toEnd.end)).toEqual(["font", "export"]);
    expect(ids(toEnd.start)).toEqual(["history", "find"]);

    const shown = placeToolbarEntry(start, group("find"), { section: "start", index: 0 });
    expect(shown.start[0]).toEqual({ kind: "group", id: "find", toolbarVisible: true });
  });

  it("adds a new divider at a slot", () => {
    const next = placeToolbarEntry(config([group("history"), group("font")]), divider("new"), {
      section: "start",
      index: 1,
    });
    expect(ids(next.start)).toEqual(["history", "new", "font"]);
  });

  it("hides a button in place and deletes a divider dropped outside the toolbar", () => {
    const before = config([group("history"), divider("d"), group("font")]);
    const hidden = hideToolbarEntry(before, "font");
    expect(hidden.start[2]).toEqual({ kind: "group", id: "font", toolbarVisible: false });
    expect(ids(hideToolbarEntry(before, "d").start)).toEqual(["history", "font"]);
  });

  it("never offers a divider a slot beside another divider or at a lane's end", () => {
    const shown = [group("history"), divider("d"), group("font"), group("find")];
    expect([0, 1, 2, 3, 4].map((index) => toolbarSlotAcceptsDivider(shown, index))).toEqual([
      false,
      false,
      false,
      true,
      false,
    ]);
  });

  it("merges two dividers a move left side by side when it drops", () => {
    const before = config([
      group("history"),
      divider("d1"),
      group("font"),
      divider("d2"),
      group("find"),
    ]);
    const after = config([
      group("history"),
      divider("d1"),
      divider("d2"),
      group("font"),
      group("find"),
    ]);
    const merged = mergeToolbarDividers(after, before);
    expect(ids(merged.start)).toEqual(["history", "d1", "font", "find"]);
  });

  it("keeps a leading and a trailing divider already stored in a lane", () => {
    const before = config(
      [divider("lead"), group("history"), group("font"), group("find"), divider("tail")],
      [divider("endLead"), group("export")]
    );
    const after = config(
      [divider("lead"), group("font"), group("history"), group("find"), divider("tail")],
      [divider("endLead"), group("export")]
    );
    const merged = mergeToolbarDividers(after, before);
    expect(ids(merged.start)).toEqual(["lead", "font", "history", "find", "tail"]);
    expect(ids(merged.end)).toEqual(["endLead", "export"]);
  });

  it("keeps two dividers a hidden button separates, so they return when it is shown", () => {
    const start = [
      group("history"),
      divider("d1"),
      group("font", false),
      divider("d2"),
      group("find"),
    ];
    const before = config(start, [group("export"), group("basic-marks", false)]);
    const after = config(start, [group("basic-marks"), group("export")]);
    expect(ids(mergeToolbarDividers(after, before).start)).toEqual([
      "history",
      "d1",
      "font",
      "d2",
      "find",
    ]);
    expect(ids(displayedToolbarEntries(mergeToolbarDividers(after, before).start))).toEqual([
      "history",
      "d1",
      "find",
    ]);
  });

  it("removes a divider a move left at a lane's end when it was shown in the other lane", () => {
    const before = config(
      [group("history"), group("font"), group("find")],
      [group("export"), divider("d1"), group("basic-marks")]
    );
    const after = config(
      [group("history"), group("font"), group("find"), divider("d1")],
      [group("export"), group("basic-marks")]
    );
    const merged = mergeToolbarDividers(after, before);
    expect(ids(merged.start)).toEqual(["history", "font", "find"]);
    expect(ids(merged.end)).toEqual(["export", "basic-marks"]);
  });
});

describe("the visual Selection layout's moves", () => {
  it("places a button at a shown slot and takes one out", () => {
    const before = config(
      [group("basic-marks"), group("headings"), group("highlight")],
      [],
      ["basic-marks", "headings"]
    );
    expect(placeSelectionToolbarEntry(before, "headings", 0).selectionToolbar).toEqual([
      "headings",
      "basic-marks",
    ]);
    expect(placeSelectionToolbarEntry(before, "highlight", 1).selectionToolbar).toEqual([
      "basic-marks",
      "highlight",
      "headings",
    ]);
    expect(removeSelectionToolbarEntry(before, "basic-marks").selectionToolbar).toEqual([
      "headings",
    ]);
  });

  it("counts slots past a missing Plugin's retained button as the author sees them", () => {
    const before = config(
      [group("basic-marks"), group("headings")],
      [],
      ["plugin.gone.tool", "basic-marks"]
    );
    expect(placeSelectionToolbarEntry(before, "headings", 0).selectionToolbar).toEqual([
      "plugin.gone.tool",
      "headings",
      "basic-marks",
    ]);
  });
});
