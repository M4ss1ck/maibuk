import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePluginLocale, parsePluginManifest } from "@/features/plugins/manifest-validate";

// The Reader manifest (#653): the host-rendered Shelf page behind a sidebar
// entry, the whole-page Frame that will hold the reading surface, and the
// reading Commands scoped to that Frame's page id.
describe("Reader manifest", () => {
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

  it("runs on desktop and the web, on demand, with custom UI", () => {
    const parsed = manifest();
    expect(parsed.platforms).toEqual(["desktop", "web"]);
    expect(parsed.lifecycle).toBe("on-demand");
    expect(parsed.customUi).toBe(true);
    expect(parsed.apiVersion).toBe("^0.1.9");
  });

  it("asks only for File Grants, never Library or editor access", () => {
    const parsed = manifest();
    expect(parsed.permissions.required).toEqual(["files:pick"]);
    expect(parsed.permissions.optional).toEqual([]);
  });

  it("opens the Shelf from a navigating Command behind a sidebar entry", () => {
    const contributes = manifest().contributes;
    const open = contributes?.commands?.find((command) => command.id === "openReader");
    expect(open?.navigates).toBe(true);
    const page = contributes?.pages?.find((candidate) => candidate.id === "reader");
    expect(page).toMatchObject({ title: "Reader", command: "openReader" });
    expect(page?.frame).toBeUndefined();
    expect(contributes?.sidebarEntries).toEqual([{ page: "reader", icon: "book-open-text" }]);
  });

  it("declares the reading page as a whole-page Frame with a navigating Command", () => {
    const contributes = manifest().contributes;
    const page = contributes?.pages?.find((candidate) => candidate.id === "document");
    expect(page).toMatchObject({ command: "openDocument", frame: "assets/ui/reader.html" });
    const open = contributes?.commands?.find((command) => command.id === "openDocument");
    expect(open?.navigates).toBe(true);
    expect(open?.contexts).toEqual(["reader"]);
  });

  it("declares the Command set, with reading Commands scoped to the reading page", () => {
    const commands = manifest().contributes?.commands ?? [];
    expect(commands.map((command) => command.id)).toEqual([
      "openReader",
      "openFile",
      "openDocument",
      "nextPage",
      "previousPage",
      "firstPage",
      "lastPage",
      "findInDocument",
      "toggleContents",
      "zoomIn",
      "zoomOut",
      "fitWidth",
      "fitPage",
      "increaseFontSize",
      "decreaseFontSize",
      "backToShelf",
    ]);
    for (const id of ["openReader", "openFile"]) {
      expect(commands.find((command) => command.id === id)?.contexts, id).toEqual(["global"]);
    }
    for (const id of [
      "nextPage",
      "previousPage",
      "firstPage",
      "lastPage",
      "findInDocument",
      "toggleContents",
      "zoomIn",
      "zoomOut",
      "fitWidth",
      "fitPage",
      "increaseFontSize",
      "decreaseFontSize",
      "backToShelf",
    ]) {
      expect(commands.find((command) => command.id === id)?.contexts, id).toEqual(["document"]);
    }
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
