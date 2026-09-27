import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/shortcut-registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/shortcut-registry")>();
  return { ...actual, COMMAND_RENAMES: { "global.oldGoto": "global.gotoProjects" } };
});

import {
  DEFAULT_SHORTCUT_SETTINGS,
  collision,
  contextsOverlap,
  defaultShortcuts,
  editableShortcuts,
  effectiveShortcuts,
  findConflicts,
  findDefaultConflicts,
  isFixedShortcut,
  normalizeShortcuts,
  parseShortcutFile,
  serializeShortcutFile,
  type CustomShortcuts,
} from "@/lib/shortcut-resolve";

describe("defaultShortcuts", () => {
  it("uses the web defaults on the web build and the desktop defaults otherwise", () => {
    expect(defaultShortcuts("bookList.newBook", false)).toEqual([["Mod+n"]]);
    expect(defaultShortcuts("bookList.newBook", true)).toEqual([["Alt+n"]]);
  });

  it("returns the registry defaults when a Command has no web variant", () => {
    expect(defaultShortcuts("global.gotoProjects", false)).toEqual([["g", "p"]]);
    expect(defaultShortcuts("global.gotoProjects", true)).toEqual([["g", "p"]]);
  });
});

describe("editableShortcuts", () => {
  it("returns nothing for a Sealed Command, even with a custom entry", () => {
    expect(editableShortcuts("bookList.jumpBooks", {}, false)).toEqual([]);
    expect(
      editableShortcuts("bookList.jumpBooks", { "bookList.jumpBooks": [["x"]] }, false)
    ).toEqual([]);
  });

  it("prefers a custom entry and keeps an explicit empty list", () => {
    expect(editableShortcuts("bookList.newBook", {}, true)).toEqual([["Alt+n"]]);
    expect(
      editableShortcuts("bookList.newBook", { "bookList.newBook": [["Mod+Shift+n"]] }, false)
    ).toEqual([["Mod+Shift+n"]]);
    expect(editableShortcuts("bookList.newBook", { "bookList.newBook": [] }, false)).toEqual([]);
  });
});

describe("effectiveShortcuts", () => {
  it("puts Fixed Shortcuts before the editable ones", () => {
    expect(effectiveShortcuts("bookList.moveSelectionNext", {}, false)).toEqual([
      ["ArrowDown"],
      ["ArrowRight"],
      ["j"],
    ]);
  });

  it("is fixed-only for a Command with no defaults", () => {
    expect(effectiveShortcuts("common.undo", {}, false)).toEqual([["Mod+z"]]);
    expect(effectiveShortcuts("bookList.openSelected", {}, false)).toEqual([["Enter"]]);
  });
});

describe("isFixedShortcut", () => {
  it("matches against the Fixed Shortcuts by identity", () => {
    expect(isFixedShortcut("common.undo", ["Mod+z"])).toBe(true);
    expect(isFixedShortcut("common.undo", ["Mod+y"])).toBe(false);
    expect(isFixedShortcut("bookList.moveSelectionNext", ["ArrowDown"])).toBe(true);
    expect(isFixedShortcut("bookList.moveSelectionNext", ["j"])).toBe(false);
  });
});

describe("contextsOverlap", () => {
  it("lets global overlap everything", () => {
    expect(contextsOverlap(["global"], ["canvas"])).toBe(true);
    expect(contextsOverlap(["canvas"], ["global"])).toBe(true);
  });

  it("uses the routes that show both contexts", () => {
    expect(contextsOverlap(["bookList"], ["canvas"])).toBe(false);
    expect(contextsOverlap(["editor"], ["canvas"])).toBe(true);
    expect(contextsOverlap(["editor"], ["image"])).toBe(true);
    expect(contextsOverlap(["noteItem"], ["notes"])).toBe(true);
    expect(contextsOverlap(["notes"], ["bookEditor"])).toBe(false);
    expect(contextsOverlap(["bookList"], ["bookList"])).toBe(true);
  });
});

describe("collision", () => {
  it("reports the kind of collision", () => {
    expect(collision(["Mod+s"], ["Mod+s"])).toBe("same");
    expect(collision(["g", "p"], ["g", "p"])).toBe("same");
    expect(collision(["g"], ["g", "p"])).toBe("prefix");
    expect(collision(["g", "p"], ["g"])).toBe("prefix");
  });

  it("returns null for unrelated shortcuts and two different sequences", () => {
    expect(collision(["Mod+s"], ["Mod+y"])).toBeNull();
    expect(collision(["g"], ["p"])).toBeNull();
    expect(collision(["g", "p"], ["g", "n"])).toBeNull();
  });
});

describe("findConflicts", () => {
  it("finds prefix conflicts in registry order", () => {
    const conflicts = findConflicts("global.showHelp", ["g"], {}, false);
    expect(conflicts.map((conflict) => conflict.id)).toEqual([
      "global.gotoProjects",
      "global.gotoNotes",
      "global.gotoCanvas",
      "global.gotoEphemeral",
      "global.gotoMetrics",
      "global.gotoSettings",
      "global.toggleTheme",
      "global.toggleShortcutHints",
      "global.startTutorial",
      "bookEditor.versionHistory",
    ]);
    expect(conflicts.every((conflict) => conflict.kind === "prefix" && !conflict.locked)).toBe(
      true
    );
  });

  it("marks a conflict with a Fixed Shortcut as locked", () => {
    const conflicts = findConflicts("editor.bold", ["Mod+z"], {}, false);
    const undo = conflicts.find((conflict) => conflict.id === "common.undo");
    expect(undo).toEqual({ id: "common.undo", shortcut: ["Mod+z"], kind: "same", locked: true });
  });

  it("does not report a conflict across disjoint contexts", () => {
    const conflicts = findConflicts("bookList.moveSelectionNext", ["p"], {}, false);
    expect(conflicts.some((conflict) => conflict.id === "canvas.toolPen")).toBe(false);
  });
});

describe("findDefaultConflicts", () => {
  it("finds no conflict in the registry defaults", () => {
    expect(findDefaultConflicts(false)).toEqual([]);
    expect(findDefaultConflicts(true)).toEqual([]);
  });
});

describe("normalizeShortcuts", () => {
  it("returns fresh defaults for non-objects and unknown versions", () => {
    expect(normalizeShortcuts(null)).toEqual(DEFAULT_SHORTCUT_SETTINGS);
    expect(normalizeShortcuts("garbage")).toEqual(DEFAULT_SHORTCUT_SETTINGS);
    expect(normalizeShortcuts([])).toEqual(DEFAULT_SHORTCUT_SETTINGS);
    expect(normalizeShortcuts({ version: 2, custom: { "editor.bold": [["Mod+b"]] } })).toEqual(
      DEFAULT_SHORTCUT_SETTINGS
    );
  });

  it("keeps a valid empty shape", () => {
    expect(normalizeShortcuts({})).toEqual({ version: 1, custom: {}, singleKeyEnabled: true });
  });

  it("normalizes singleKeyEnabled", () => {
    expect(normalizeShortcuts({ version: 1, singleKeyEnabled: false }).singleKeyEnabled).toBe(
      false
    );
    expect(normalizeShortcuts({ version: 1, singleKeyEnabled: "yes" }).singleKeyEnabled).toBe(true);
  });

  it("drops unknown and sealed Commands", () => {
    expect(normalizeShortcuts({ version: 1, custom: { "nope.nope": [["a"]] } }).custom).toEqual({});
    expect(
      normalizeShortcuts({ version: 1, custom: { "bookList.jumpBooks": [["a"]] } }).custom
    ).toEqual({});
  });

  it("drops entries whose shortcuts are all invalid", () => {
    expect(normalizeShortcuts({ version: 1, custom: { "editor.bold": [["Foo"]] } }).custom).toEqual(
      {}
    );
    expect(
      normalizeShortcuts({ version: 1, custom: { "editor.bold": [["Enter"]] } }).custom
    ).toEqual({});
    expect(normalizeShortcuts({ version: 1, custom: { "editor.bold": "x" } }).custom).toEqual({});
  });

  it("keeps valid shortcuts, normalizes and deduplicates them", () => {
    const settings = normalizeShortcuts({
      version: 1,
      custom: { "editor.bold": [["Mod+b"], ["Mod+B"], ["mod+B"]] },
    });
    expect(settings.custom["editor.bold"]).toEqual([["Mod+b"]]);
  });

  it("keeps a mixed entry's valid shortcuts and an explicit empty list", () => {
    const settings = normalizeShortcuts({
      version: 1,
      custom: { "editor.bold": [["Mod+b"], ["Enter"]], "editor.italic": [] },
    });
    expect(settings.custom["editor.bold"]).toEqual([["Mod+b"]]);
    expect(settings.custom["editor.italic"]).toEqual([]);
  });

  it("carries a renamed Command id to its current id", () => {
    const settings = normalizeShortcuts({
      version: 1,
      custom: { "global.oldGoto": [["Mod+Shift+y"]] },
    });
    expect(settings.custom["global.gotoProjects"]).toEqual([["Mod+Shift+y"]]);
  });
});

describe("serializeShortcutFile / parseShortcutFile", () => {
  it("round-trips a Custom Shortcuts map", () => {
    const custom: CustomShortcuts = { "editor.bold": [["Mod+b"]], "editor.italic": [] };
    expect(parseShortcutFile(serializeShortcutFile(custom), false)).toEqual({
      ok: true,
      custom,
      dropped: [],
    });
  });

  it("reports parse, kind and version errors", () => {
    expect(parseShortcutFile("not json", false)).toEqual({ ok: false, error: "parse" });
    expect(parseShortcutFile("null", false)).toEqual({ ok: false, error: "kind" });
    expect(parseShortcutFile("[]", false)).toEqual({ ok: false, error: "kind" });
    expect(
      parseShortcutFile(
        JSON.stringify({ app: "other", kind: "shortcuts", version: 1, custom: {} }),
        false
      )
    ).toEqual({ ok: false, error: "kind" });
    expect(
      parseShortcutFile(
        JSON.stringify({ app: "maibuk", kind: "other", version: 1, custom: {} }),
        false
      )
    ).toEqual({ ok: false, error: "kind" });
    expect(
      parseShortcutFile(
        JSON.stringify({ app: "maibuk", kind: "shortcuts", version: 2, custom: {} }),
        false
      )
    ).toEqual({ ok: false, error: "version" });
    for (const custom of [undefined, null, [], "bad"]) {
      expect(
        parseShortcutFile(
          JSON.stringify({ app: "maibuk", kind: "shortcuts", version: 1, custom }),
          false
        )
      ).toEqual({ ok: false, error: "kind" });
    }
  });

  it("drops unknown, sealed and malformed entries", () => {
    const file = serializeShortcutFile({
      "nope.nope": [["a"]],
      "bookList.jumpBooks": [["x"]],
      "editor.bold": "x",
    } as unknown as CustomShortcuts);
    expect(parseShortcutFile(file, false)).toEqual({
      ok: true,
      custom: {},
      dropped: [
        { id: "nope.nope", reason: "unknown" },
        { id: "bookList.jumpBooks", reason: "sealed" },
        { id: "editor.bold", reason: "invalid" },
      ],
    });
  });

  it("drops a web-reserved shortcut only on the web build", () => {
    const file = serializeShortcutFile({ "bookList.newBook": [["Mod+t"]] });
    expect(parseShortcutFile(file, true)).toEqual({
      ok: true,
      custom: {},
      dropped: [{ id: "bookList.newBook", shortcut: ["Mod+t"], reason: "reserved" }],
    });
    expect(parseShortcutFile(file, false)).toEqual({
      ok: true,
      custom: { "bookList.newBook": [["Mod+t"]] },
      dropped: [],
    });
  });

  it("drops a shortcut that conflicts with one already accepted from the file", () => {
    const file = serializeShortcutFile({
      "global.gotoProjects": [["Mod+q"]],
      "global.gotoNotes": [["Mod+q"]],
    });
    expect(parseShortcutFile(file, false)).toEqual({
      ok: true,
      custom: { "global.gotoProjects": [["Mod+q"]] },
      dropped: [{ id: "global.gotoNotes", shortcut: ["Mod+q"], reason: "conflict" }],
    });
  });

  it("drops an invalid shortcut but keeps a valid sibling and an explicit empty list", () => {
    const file = serializeShortcutFile({
      "editor.bold": [["Mod+b"], ["Foo"]],
      "editor.italic": [],
    });
    expect(parseShortcutFile(file, false)).toEqual({
      ok: true,
      custom: { "editor.bold": [["Mod+b"]], "editor.italic": [] },
      dropped: [{ id: "editor.bold", shortcut: ["Foo"], reason: "invalid" }],
    });
  });
});
