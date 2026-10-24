// @vitest-environment node
// Every Built-in Plugin passes `plugin:check`'s lint step. That step runs
// `biome check`, which includes the formatter, while the repo's `pnpm lint`
// runs `biome lint` only, so formatter drift under `plugins/` passed CI and
// surfaced only when someone ran `plugin:check` by hand (#646).
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { lintStep } from "../../../../../scripts/plugin/steps";

const maibukRoot = resolve(__dirname, "../../../../..");
const builtIns = readdirSync(join(maibukRoot, "plugins"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

describe("Built-in Plugin lint", () => {
  it("finds the Built-in Plugins", () => {
    expect(builtIns).toContain("maibuk-mcp");
  });

  it.each(builtIns)("%s passes plugin:check's lint step", async (id) => {
    const result = await lintStep({
      pluginRoot: join(maibukRoot, "plugins", id),
      maibukRoot,
      builtIn: true,
    });
    expect(result.details.join("\n")).toBe("biome reported no problems");
    expect(result.ok).toBe(true);
  });
});
