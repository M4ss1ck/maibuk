import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePluginManifest } from "@/features/plugins/manifest-validate";

// Draft manifest (#449): Commands, pages, and the entry land with the Echoes UI tickets.
describe("Echoes draft manifest", () => {
  const text = readFileSync(join(__dirname, "manifest.json"), "utf8");

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
});
