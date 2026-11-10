import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePluginLocale, parsePluginManifest } from "@/features/plugins/manifest-validate";
import en from "./locales/runtime/en.json";
import es from "./locales/runtime/es.json";
import { DATA_VERSION } from "./maps";

// The Maps manifest (#744): web and desktop only, the four Plugin Permissions
// the whole Plugin needs (#737 Decision 1), the Maps page behind a sidebar
// entry, and a Book Item Menu entry that opens it filtered to that Book.
describe("Maps manifest", () => {
  const text = readFileSync(join(__dirname, "manifest.json"), "utf8");

  function manifest() {
    const result = parsePluginManifest(text, { builtIn: true });
    if (!result.ok) throw new Error(JSON.stringify(result.problems));
    return result.manifest;
  }

  it("passes Built-in Plugin manifest validation", () => {
    const result = parsePluginManifest(text, { builtIn: true });
    expect(result.ok ? [] : result.problems).toEqual([]);
  });

  it("runs on the web and desktop, not Android", () => {
    expect(manifest().platforms).toEqual(["web", "desktop"]);
  });

  it("asks for Library reads, editor writes, and file pick and save", () => {
    expect(manifest().permissions.required).toEqual([
      "library:read",
      "editor:write",
      "files:pick",
      "files:save",
    ]);
    expect(manifest().permissions.optional).toEqual([]);
  });

  it("declares the data version the store writes", () => {
    expect(manifest().dataVersion).toBe(DATA_VERSION);
  });

  it("opens the Maps page from a navigating Command behind a sidebar entry", () => {
    const contributes = manifest().contributes;
    expect(contributes?.commands?.find((command) => command.id === "openMaps")?.navigates).toBe(
      true
    );
    expect(contributes?.pages?.find((page) => page.id === "maps")?.command).toBe("openMaps");
    expect(contributes?.sidebarEntries).toEqual([{ page: "maps", icon: "map" }]);
  });

  it("contributes Maps to the Book Item Menu", () => {
    const contributes = manifest().contributes;
    expect(contributes?.commands?.find((command) => command.id === "bookMaps")?.targets).toEqual([
      "book",
    ]);
    expect(contributes?.itemMenuEntries).toEqual([{ command: "bookMaps" }]);
  });

  it("declares the Map editor page as custom UI behind its own Command", () => {
    const parsed = manifest();
    expect(parsed.customUi).toBe(true);
    const page = parsed.contributes?.pages?.find((candidate) => candidate.id === "map");
    expect(page).toMatchObject({ title: "Map", command: "openMap", hideTitle: true });
    expect(
      parsed.contributes?.commands?.find((command) => command.id === "openMap")?.navigates
    ).toBe(true);
  });

  it("binds every Map editor Command on the Map page", () => {
    const commands = manifest().contributes?.commands ?? [];
    const onMap = [
      "undo",
      "redo",
      "zoomIn",
      "zoomOut",
      "zoomReset",
      "panLeft",
      "panRight",
      "panUp",
      "panDown",
      "moveLeft",
      "moveRight",
      "moveUp",
      "moveDown",
      "moveLeftFar",
      "moveRightFar",
      "moveUpFar",
      "moveDownFar",
      "selectTool",
      "pencilTool",
      "penTool",
      "ellipseTool",
      "rectangleTool",
      "polygonTool",
      "eraserTool",
      "roughen",
      "deleteElement",
    ];
    for (const id of onMap) {
      const command = commands.find((candidate) => candidate.id === id);
      expect(command, id).toBeDefined();
      expect(command?.contexts, id).toEqual(["map"]);
      expect(command?.defaults?.length ?? 0, id).toBeGreaterThan(0);
    }
    expect(commands.find((command) => command.id === "undo")?.defaults).toEqual([["Mod+z"]]);
    expect(commands.find((command) => command.id === "moveLeft")?.defaults).toEqual([
      ["ArrowLeft"],
    ]);
    expect(commands.find((command) => command.id === "moveDownFar")?.defaults).toEqual([
      ["Shift+ArrowDown"],
    ]);
    expect(commands.find((command) => command.id === "penTool")?.defaults).toEqual([["n"]]);
    expect(commands.find((command) => command.id === "ellipseTool")?.defaults).toEqual([["o"]]);
    expect(commands.find((command) => command.id === "rectangleTool")?.defaults).toEqual([["r"]]);
    expect(commands.find((command) => command.id === "polygonTool")?.defaults).toEqual([["s"]]);
    expect(commands.find((command) => command.id === "eraserTool")?.defaults).toEqual([["e"]]);
    expect(commands.find((command) => command.id === "roughen")?.defaults).toEqual([
      ["Mod+Shift+r"],
    ]);
  });

  it("localizes its host-visible strings in English and Spanish", () => {
    const parsed = manifest();
    const contributes = parsed.contributes;
    const expected = [
      "name",
      "description",
      ...(contributes?.commands ?? []).map((command) => `commands.${command.id}.label`),
      ...(contributes?.pages ?? []).map((page) => `pages.${page.id}.title`),
    ].sort();
    for (const language of ["en", "es"] as const) {
      const locale = readFileSync(join(__dirname, "locales", `${language}.json`), "utf8");
      const result = parsePluginLocale(locale, language, parsed);
      expect(result.ok ? [] : result.problems).toEqual([]);
      expect(Object.keys(JSON.parse(locale)).sort()).toEqual(expected);
    }
  });

  it("ships every runtime string in English and Spanish", () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
    for (const [key, value] of Object.entries(es)) expect(value, key).not.toBe("");
  });
});
