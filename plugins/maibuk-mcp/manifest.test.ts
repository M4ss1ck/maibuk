import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePluginManifest } from "@/features/plugins/manifest-validate";

// The MCP Server manifest: desktop-only and persistent, asking only for the
// Plugin Endpoint and Library reads and writes. It contributes no UI: an
// Agent reaches this Plugin only through HTTP.
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

  it("asks only for the endpoint and Library reads and writes", () => {
    expect(manifest().permissions.required).toEqual(["serve", "library:read", "library:write"]);
    expect(manifest().permissions.optional).toEqual([]);
  });

  it("contributes no UI", () => {
    expect(manifest().contributes).toBeUndefined();
  });
});
