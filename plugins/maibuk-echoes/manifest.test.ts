import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePluginLocale, parsePluginManifest } from "@/features/plugins/manifest-validate";

// The Echoes manifest (#450): its page, sidebar entry, Settings row, and the
// two Commands (`Open Echoes` opens the report page; `Find echoes` joins the
// Chapter and Book Item Menus and opens the report scoped to that item).
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

  it("contributes Find echoes to the Chapter and Book Item Menus", () => {
    const contributes = manifest().contributes;
    const find = contributes?.commands?.find((command) => command.id === "findEchoes");
    expect(find?.targets).toEqual(["book", "chapter"]);
    expect(contributes?.itemMenuEntries?.map((entry) => entry.command)).toEqual(["findEchoes"]);
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
