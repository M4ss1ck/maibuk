// @vitest-environment node
// Every Built-in Plugin passes `plugin:check`'s static steps that CI does not
// otherwise run. Lint is `biome check`, formatter included, while the repo's
// `pnpm lint` is `biome lint` only; the import boundary refuses host modules a
// Plugin may not reach. Both regressed in maibuk-mcp unnoticed, found only by
// running `plugin:check` by hand (#646).
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { boundaryStep, lintStep } from "../../../../../scripts/plugin/steps";

const maibukRoot = resolve(__dirname, "../../../../..");
const builtIns = readdirSync(join(maibukRoot, "plugins"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const context = (id: string) => ({
  pluginRoot: join(maibukRoot, "plugins", id),
  maibukRoot,
  builtIn: true,
});

describe("Built-in Plugin static checks", () => {
  it("finds the Built-in Plugins", () => {
    expect(builtIns).toContain("maibuk-mcp");
  });

  it.each(builtIns)("%s passes plugin:check's lint step", async (id) => {
    const result = await lintStep(context(id));
    expect(result.details.join("\n")).toBe("biome reported no problems");
    expect(result.ok).toBe(true);
  });

  it.each(builtIns)("%s passes plugin:check's import boundary step", async (id) => {
    const result = await boundaryStep(context(id));
    expect(result.details.join("\n")).toBe("no refused imports");
    expect(result.ok).toBe(true);
  });
});
