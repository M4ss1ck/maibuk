import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isInlineIcon } from "@/features/plugins/inline-icon";
import { validateManifestValue } from "@/features/plugins/manifest-validate";

const manifestPath = resolve(__dirname, "../../../../../plugins/maibuk-echoes/manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

describe("Echoes toolbar icon (#531)", () => {
  it("uses its own inline highlighter icon, not the Lucide highlighter the editor uses", () => {
    const button = manifest.contributes.toolbarButtons.find(
      (candidate: { id: string }) => candidate.id === "toggleHighlights"
    );
    expect(isInlineIcon(button.icon)).toBe(true);
    expect(button.icon.elements.length).toBeGreaterThan(0);
  });

  it("passes the manifest validator, so the shipped icon is inside the allowlist", () => {
    expect(validateManifestValue(manifest, { builtIn: true }).ok).toBe(true);
  });
});
