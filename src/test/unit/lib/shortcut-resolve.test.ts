import { describe, expect, it } from "vitest";
import { COMMAND_RENAMES } from "@/lib/shortcut-registry";

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
    expect(effectiveShortcuts("common.redo", {}, false)).toEqual([["Mod+Shift+z"], ["Mod+y"]]);
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
    expect(isFixedShortcut("common.redo", ["Mod+Shift+z"])).toBe(true);
    expect(isFixedShortcut("common.redo", ["Mod+y"])).toBe(false);
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
    expect(normalizeShortcuts({ version: 3, custom: { "editor.bold": [["Mod+b"]] } })).toEqual(
      DEFAULT_SHORTCUT_SETTINGS
    );
  });

  it("keeps a valid empty shape", () => {
    expect(normalizeShortcuts({})).toEqual({
      version: 2,
      custom: {},
      voice: {},
      singleKeyEnabled: true,
    });
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
    // The rename table ships empty; a future entry is proven through it here.
    const renames = COMMAND_RENAMES as Record<string, string>;
    renames["global.oldGoto"] = "global.gotoProjects";
    try {
      const settings = normalizeShortcuts({
        version: 1,
        custom: { "global.oldGoto": [["Mod+Shift+y"]] },
      });
      expect(settings.custom["global.gotoProjects"]).toEqual([["Mod+Shift+y"]]);
    } finally {
      delete renames["global.oldGoto"];
    }
  });
});

describe("serializeShortcutFile / parseShortcutFile", () => {
  it("round-trips a Custom Shortcuts map", () => {
    const custom: CustomShortcuts = { "editor.bold": [["Mod+b"]], "editor.italic": [] };
    expect(parseShortcutFile(serializeShortcutFile(custom), false)).toEqual({
      ok: true,
      voice: {},
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
        JSON.stringify({ app: "maibuk", kind: "shortcuts", version: 3, custom: {} }),
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
      voice: {},
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
      voice: {},
      custom: {},
      dropped: [{ id: "bookList.newBook", shortcut: ["Mod+t"], reason: "reserved" }],
    });
    expect(parseShortcutFile(file, false)).toEqual({
      ok: true,
      voice: {},
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
      voice: {},
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
      voice: {},
      custom: { "editor.bold": [["Mod+b"]], "editor.italic": [] },
      dropped: [{ id: "editor.bold", shortcut: ["Foo"], reason: "invalid" }],
    });
  });
});

describe("shortcut settings version 2: custom Voice Commands", () => {
  it("migrates the version 1 shape and keeps every Custom Shortcut", () => {
    const v1 = {
      version: 1,
      custom: { "editor.bold": [["Mod+Shift+k"]], "global.syncNow": [] },
      singleKeyEnabled: false,
    };
    expect(normalizeShortcuts(v1)).toEqual({
      version: 2,
      custom: { "editor.bold": [["Mod+Shift+k"]], "global.syncNow": [] },
      voice: {},
      singleKeyEnabled: false,
    });
    // A record from before versioning had the version 1 shape.
    expect(normalizeShortcuts({ custom: { "editor.bold": [["Mod+Shift+k"]] } }).custom).toEqual({
      "editor.bold": [["Mod+Shift+k"]],
    });
  });

  it("ignores a stray voice field in a version 1 record", () => {
    expect(
      normalizeShortcuts({ version: 1, custom: {}, voice: { "editor.bold": { es: ["a b"] } } })
        .voice
    ).toEqual({});
  });

  it("normalizes the stored Voice Commands", () => {
    expect(
      normalizeShortcuts({
        version: 2,
        custom: {},
        voice: {
          "editor.bold": { es: ["pon esto fuerte", "negrita"] },
          "common.save": { en: ["save it now"] },
          "bogus.command": { en: ["a b"] },
        },
        singleKeyEnabled: true,
      }).voice
    ).toEqual({
      "editor.bold": { es: ["pon esto fuerte"] },
      "common.save": { en: ["save it now"] },
    });
  });

  it("round-trips Voice Commands through the Shortcut File", () => {
    const custom: CustomShortcuts = { "editor.bold": [["Mod+b"]] };
    const voice = { "editor.bold": { es: ["pon esto fuerte"], en: [] } };
    const text = serializeShortcutFile(custom, voice);
    expect(JSON.parse(text)).toMatchObject({ app: "maibuk", kind: "shortcuts", version: 2 });
    expect(parseShortcutFile(text, false)).toEqual({ ok: true, custom, voice, dropped: [] });
  });

  it("loads a version 1 file with no Voice Commands", () => {
    const text = JSON.stringify({
      app: "maibuk",
      kind: "shortcuts",
      version: 1,
      custom: { "editor.bold": [["Mod+b"]] },
    });
    expect(parseShortcutFile(text, false)).toEqual({
      ok: true,
      custom: { "editor.bold": [["Mod+b"]] },
      voice: {},
      dropped: [],
    });
  });

  it("reports every Voice Command it drops", () => {
    const text = JSON.stringify({
      app: "maibuk",
      kind: "shortcuts",
      version: 2,
      custom: {},
      voice: {
        "bogus.command": { es: ["a b"] },
        "common.save": { es: ["guardar ya"] },
        "editor.italic": "letra inclinada",
        "editor.bold": { es: ["negrita", 3, "pon esto fuerte", "Pon esto fuerte"], en: "x" },
      },
    });
    const result = parseShortcutFile(text, false);
    expect(result).toEqual({
      ok: true,
      custom: {},
      voice: { "editor.bold": { es: ["pon esto fuerte"] }, "common.save": { es: ["guardar ya"] } },
      dropped: [
        { id: "bogus.command", reason: "unknown" },
        { id: "editor.italic", reason: "invalid" },
        { id: "editor.bold", language: "en", reason: "invalid" },
        { id: "editor.bold", language: "es", phrase: "negrita", reason: "tooShort" },
        { id: "editor.bold", language: "es", reason: "invalid" },
      ],
    });
  });

  it("drops a phrase the caller's check refuses, seeing what the file kept so far", () => {
    const text = serializeShortcutFile(
      {},
      { "editor.bold": { es: ["uno dos", "tres cuatro"] }, "editor.italic": { es: ["uno dos"] } }
    );
    const seen: unknown[] = [];
    const result = parseShortcutFile(text, false, ({ id, phrase, accepted }) => {
      seen.push(structuredClone(accepted));
      return id === "editor.italic" && accepted["editor.bold"]?.es?.includes(phrase) === true;
    });
    expect(result).toMatchObject({
      ok: true,
      voice: { "editor.bold": { es: ["uno dos", "tres cuatro"] } },
      dropped: [{ id: "editor.italic", language: "es", phrase: "uno dos", reason: "conflict" }],
    });
    // The Command's own list starts empty, so its defaults never count against it.
    expect(seen[0]).toEqual({ "editor.bold": { es: [] } });
  });
});
