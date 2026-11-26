import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePluginLocale, parsePluginManifest } from "@/features/plugins/manifest-validate";

// The Reader manifest (#653, #944): the Shelf and reading Frames behind their
// sidebar entry and Command, and the reading Commands scoped to the reading
// page's id.
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

  it("runs on desktop, the web, and Android, on demand, with custom UI", () => {
    const parsed = manifest();
    expect(parsed.platforms).toEqual(["desktop", "web", "android"]);
    expect(parsed.lifecycle).toBe("on-demand");
    expect(parsed.customUi).toBe(true);
    expect(parsed.apiVersion).toBe("^0.1.15");
  });

  it("declares the Documents Canvas Reference source and the API version it needs", () => {
    const parsed = manifest();
    expect(parsed.apiVersion).toBe("^0.1.15");
    expect(parsed.contributes?.canvasReferenceSources).toEqual([
      { id: "documents", label: "Documents", icon: "book-open-text", preview: "portrait" },
    ]);
  });

  it("asks only for File Grants, never Library or editor access", () => {
    const parsed = manifest();
    expect(parsed.permissions.required).toEqual(["files:pick"]);
    expect(parsed.permissions.optional).toEqual([]);
  });

  it("opens the Shelf Frame from a navigating Command behind a sidebar entry", () => {
    const contributes = manifest().contributes;
    const open = contributes?.commands?.find((command) => command.id === "openReader");
    expect(open?.navigates).toBe(true);
    const page = contributes?.pages?.find((candidate) => candidate.id === "reader");
    expect(page).toMatchObject({
      title: "Reader",
      command: "openReader",
      frame: "assets/ui/shelf.html",
      hideTitle: true,
    });
    expect(contributes?.sidebarEntries).toEqual([{ page: "reader", icon: "book-open-text" }]);
  });

  it("declares the reading page as a whole-page Frame with a navigating Command", () => {
    const contributes = manifest().contributes;
    const page = contributes?.pages?.find((candidate) => candidate.id === "document");
    expect(page).toMatchObject({
      command: "openDocument",
      frame: "assets/ui/reader.html",
      // The Frame draws its own Back, which returns to the place that opened it (#786).
      hideBack: true,
    });
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
      "toggleContinuousScroll",
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
      "toggleContinuousScroll",
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
