import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePluginLocale, parsePluginManifest } from "@/features/plugins/manifest-validate";

// The MCP Server manifest: desktop-only and persistent, asking only for the
// Plugin Endpoint and Library reads and writes. It contributes one Command,
// `newKey`, which makes a new Key; an Agent reaches this Plugin only through
// HTTP.
describe("MCP Server manifest", () => {
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

  it("identifies the Plugin as maibuk-mcp", () => {
    expect(manifest().id).toBe("maibuk-mcp");
    expect(manifest().name).toBe("MCP Server");
  });

  it("runs persistent on desktop only", () => {
    expect(manifest().platforms).toEqual(["desktop"]);
    expect(manifest().lifecycle).toBe("persistent");
  });

  it("asks only for the endpoint and Library reads, with writes optional", () => {
    expect(manifest().permissions.required).toEqual(["serve", "library:read"]);
    expect(manifest().permissions.optional).toEqual(["library:write"]);
  });

  it("contributes the newKey Command with no default shortcut", () => {
    const command = manifest().contributes?.commands?.find(
      (candidate) => candidate.id === "newKey"
    );
    expect(command?.label).toBe("Make a New MCP Server Key");
    expect(command?.contexts).toEqual(["global"]);
    expect(command?.defaults).toBeUndefined();
  });

  it("localizes the newKey Command title in Spanish", () => {
    const locale = JSON.parse(readFileSync(join(__dirname, "locales", "es.json"), "utf8"));
    expect(locale["commands.newKey.label"]).toBe("Crear una clave nueva del servidor MCP");
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
