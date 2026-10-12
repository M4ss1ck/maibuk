// @vitest-environment node
//
// The generated SDK component declarations (`src/plugin-sdk/ui.generated.ts`)
// must match the UI kit table. This gate regenerates in memory and compares, so
// a stale file fails the suite the way `pnpm generate:plugin-ui` would fix it.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderPluginUiTypes } from "@/features/plugins/ui-codegen";
import { PLUGIN_UI_TABLE } from "@/plugin-sdk/ui-table";

describe("generated Plugin UI types", () => {
  it("match the table", () => {
    const path = join(process.cwd(), "src/plugin-sdk/ui.generated.ts");
    expect(readFileSync(path, "utf8")).toBe(renderPluginUiTypes(PLUGIN_UI_TABLE));
  });
});
