import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePluginLocale, parsePluginManifest } from "@/features/plugins/manifest-validate";

// The Echoes manifest (#450): its page, sidebar entry, Settings row, and the
// two Commands (`Open Echoes` opens the report page; `Find echoes` joins the
// Chapter Item Menu and opens the report scoped to that Chapter).
describe("Echoes manifest", () => {
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

  it("lists android, web, and desktop in platforms (#517)", () => {
    expect(manifest().platforms).toEqual(["web", "desktop", "android"]);
  });

  it("asks only for read access and editor highlights, never Library writes", () => {
    const result = parsePluginManifest(text, { builtIn: true });
    if (!result.ok) throw new Error("manifest invalid");
    expect(result.manifest.permissions.required).toEqual([
      "library:read",
      "editor:read",
      "editor:decorate",
    ]);
    expect(result.manifest.permissions.optional).toEqual([]);
  });

  it("opens the report from a navigating Command behind a sidebar entry", () => {
    const contributes = manifest().contributes;
    const open = contributes?.commands?.find((command) => command.id === "openEchoes");
    expect(open?.navigates).toBe(true);
    const page = contributes?.pages?.find((candidate) => candidate.id === "report");
    expect(page?.command).toBe("openEchoes");
    expect(contributes?.sidebarEntries?.find((entry) => entry.page === "report")?.icon).toBe(
      "waves"
    );
  });

  it("contributes Find echoes to the Chapter Item Menu", () => {
    const contributes = manifest().contributes;
    const find = contributes?.commands?.find((command) => command.id === "findEchoes");
    expect(find?.targets).toEqual(["chapter"]);
    expect(contributes?.itemMenuEntries?.map((entry) => entry.command)).toEqual(["findEchoes"]);
  });

  it("contributes the editor Commands with free Default Shortcuts", () => {
    const commands = manifest().contributes?.commands ?? [];
    for (const id of ["toggleHighlights", "nextEcho", "previousEcho"]) {
      const command = commands.find((candidate) => candidate.id === id);
      expect(command?.contexts, id).toEqual(["editor"]);
      expect(command?.defaults ?? [], id).toHaveLength(1);
    }
    expect(commands.find((command) => command.id === "toggleHighlights")?.defaults).toEqual([
      ["Alt+F7"],
    ]);
    expect(commands.find((command) => command.id === "nextEcho")?.defaults).toEqual([["Alt+F8"]]);
    expect(commands.find((command) => command.id === "previousEcho")?.defaults).toEqual([
      ["Alt+Shift+F8"],
    ]);
  });

  it("contributes the toggle as an editor toolbar button", () => {
    expect(manifest().contributes?.toolbarButtons).toEqual([
      {
        id: "toggleHighlights",
        command: "toggleHighlights",
        icon: {
          elements: [
            ["path", { d: "m9 11-6 6v3h9l3-3" }],
            ["path", { d: "m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" }],
            ["path", { d: "M3 2.5h4.5" }],
            ["path", { d: "M3 2.5v7" }],
            ["path", { d: "M3 6h3.5" }],
            ["path", { d: "M3 9.5h4.5" }],
          ],
        },
        toggle: true,
      },
    ]);
  });

  it("contributes one Settings row for detection", () => {
    expect(manifest().contributes?.settingsRows?.map((row) => row.id)).toEqual(["detection"]);
  });

  it("localizes its host-visible strings through locales/<lang>.json", () => {
    const parsed = manifest();
    for (const language of ["en", "es"] as const) {
      const locale = readFileSync(join(__dirname, "locales", `${language}.json`), "utf8");
      const result = parsePluginLocale(locale, language, parsed);
      expect(result.ok ? [] : result.problems).toEqual([]);
    }
  });
});
