// @vitest-environment node
//
// The pure half of the E2E clone seeding (`e2e/support/storage.ts`, issue
// #448): `clonePluginId` names the N-th copy and `clonePluginManifest` rewrites
// a fixture manifest for it — its id and name become the clone's, and every
// Command drops its default Shortcuts so no clone collides with a sibling. The
// rewritten manifest must still pass the real validator.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePluginManifest } from "@/features/plugins/manifest-validate";
import { clonePluginId, clonePluginManifest } from "../../../e2e/support/storage";

// fixture-everything's manifest declares a Command with a default Shortcut
// (`Mod+Alt+e`), so the drop is observable.
const SOURCE_MANIFEST = readFileSync(
  join(process.cwd(), "e2e/fixtures/plugin-sources/fixture-everything/manifest.json"),
  "utf8"
);

describe("clonePluginId", () => {
  it("names each copy <from>-clone-NN, zero-padded to two digits", () => {
    expect(clonePluginId("fixture-everything-on-demand", 1)).toBe(
      "fixture-everything-on-demand-clone-01"
    );
    expect(clonePluginId("fixture-bench", 20)).toBe("fixture-bench-clone-20");
    // Past 99 the ordinal simply grows; the id stays a valid slug.
    expect(clonePluginId("fixture-bench", 100)).toBe("fixture-bench-clone-100");
  });
});

describe("clonePluginManifest", () => {
  const id = "fixture-everything-clone-03";
  const name = "Fixture Everything Clone 3";
  const clone = JSON.parse(clonePluginManifest(SOURCE_MANIFEST, id, name)) as {
    id: string;
    name: string;
    contributes?: { commands?: Record<string, unknown>[]; pages?: unknown };
  };
  const source = JSON.parse(SOURCE_MANIFEST) as {
    contributes?: { commands?: Record<string, unknown>[]; pages?: unknown };
  };

  it("rewrites only the id and the name", () => {
    expect(clone.id).toBe(id);
    expect(clone.name).toBe(name);
    expect(clone.contributes?.pages).toEqual(source.contributes?.pages);
  });

  it("drops every Command's default and web Shortcuts so clones never collide", () => {
    const sourceCommands = source.contributes?.commands ?? [];
    expect(sourceCommands.some((command) => command.defaults !== undefined)).toBe(true);
    const commands = clone.contributes?.commands ?? [];
    expect(commands.length).toBe(sourceCommands.length);
    for (const command of commands) {
      expect(command.defaults).toBeUndefined();
      expect(command.web).toBeUndefined();
    }
  });

  it("stays a manifest the real validator accepts", () => {
    const result = parsePluginManifest(clonePluginManifest(SOURCE_MANIFEST, id, name));
    if (!result.ok) throw new Error(JSON.stringify(result.problems, null, 2));
    expect(result.manifest.id).toBe(id);
    expect(result.manifest.name).toBe(name);
  });
});
