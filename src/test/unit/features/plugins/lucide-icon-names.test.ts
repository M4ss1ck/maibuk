import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dynamicIconImports } from "lucide-react/dynamic";

// Gate for src/features/plugins/lucide-icon-names.json, the committed list the
// manifest validator checks icon names against. Regenerate with
// `pnpm generate:plugin-manifest` after bumping lucide-react.
describe("lucide-icon-names.json", () => {
  it("is exactly the dynamic icon map's keys (run pnpm generate:plugin-manifest)", () => {
    const committed = JSON.parse(
      readFileSync("src/features/plugins/lucide-icon-names.json", "utf8")
    ) as string[];
    expect(committed).toEqual(Object.keys(dynamicIconImports).sort());
  });

  it("contains the icons used by the base manifest fixture", () => {
    const committed = new Set(
      JSON.parse(readFileSync("src/features/plugins/lucide-icon-names.json", "utf8")) as string[]
    );
    for (const name of ["search", "highlighter", "book-open", "sparkles"]) {
      expect(committed.has(name), name).toBe(true);
    }
  });
});
