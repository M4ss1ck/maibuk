// @vitest-environment node
//
// The generated SDK component declarations (`src/plugin-sdk/ui.generated.ts`)
// must match the UI kit table. This gate regenerates in memory and compares, so
// a stale file fails the suite the way `pnpm generate:plugin-ui` would fix it.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderPluginUiReference, renderPluginUiTypes } from "@/features/plugins/ui-codegen";
import { PLUGIN_UI_TABLE, type PluginUiElement } from "@/plugin-sdk/ui-table";

describe("generated Plugin UI types", () => {
  it("match the table", () => {
    const path = join(process.cwd(), "src/plugin-sdk/ui.generated.ts");
    expect(readFileSync(path, "utf8")).toBe(renderPluginUiTypes(PLUGIN_UI_TABLE));
  });

  it("omits internal props, such as the SDK's openSeq, from the public types", () => {
    const output = renderPluginUiTypes(PLUGIN_UI_TABLE);
    expect(output).not.toContain("openSeq");
  });
});

describe("generated Plugin UI reference", () => {
  it("ui-reference.md is exactly what the generator emits (run pnpm generate:plugin-ui)", () => {
    const path = join(process.cwd(), "docs/plugins/ui-reference.md");
    const committed = readFileSync(path, "utf8");
    expect(committed, "run pnpm generate:plugin-ui").toBe(renderPluginUiReference(PLUGIN_UI_TABLE));
  });

  it("gives every table tag its own section, in table order", () => {
    const reference = renderPluginUiReference(PLUGIN_UI_TABLE);
    const headings = [...reference.matchAll(/^## `([^`]+)`$/gm)].map((match) => match[1]);
    expect(headings).toEqual(PLUGIN_UI_TABLE.map((element) => element.tag));
  });

  it("changes when a row changes, so the stale check fires (add a prop to one element)", () => {
    const [first, ...rest] = PLUGIN_UI_TABLE;
    const mutated: readonly PluginUiElement[] = [
      {
        ...first,
        props: { ...first.props, extra: { kind: "boolean", description: "A new prop." } },
      },
      ...rest,
    ];
    expect(renderPluginUiReference(mutated)).not.toBe(renderPluginUiReference(PLUGIN_UI_TABLE));
  });
});
