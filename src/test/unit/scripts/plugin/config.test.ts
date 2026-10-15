// @vitest-environment node
// The generated configuration for an external Plugin (issue #455): the aliases
// that resolve the SDK, the test kit, and React to Maibuk's copy, the test-only
// fallback resolver, and the two TypeScript configs the typecheck step writes.
// The functions are pure; only `writeGeneratedConfigs` touches the disk, into
// `<plugin>/.maibuk/`. A root path with spaces must survive every string intact,
// because the tooling never goes through a shell.
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  externalAliases,
  testFallbackResolver,
  tsconfigForCheck,
  tsconfigPaths,
  writeGeneratedConfigs,
} from "../../../../../scripts/plugin/config";

/** A Maibuk checkout whose path contains spaces, to prove no string is shell-split. */
const MAIBUK_ROOT = "/home/author/maibuk checkout";
/** A Plugin repo whose path contains spaces. */
const PLUGIN_ROOT = "/home/author/my plugin";
/** The real checkout, for the fallback resolver test that must resolve a real package. */
const REAL_MAIBUK_ROOT = resolve(import.meta.dirname, "../../../../..");

const roots: string[] = [];

function tempDir(prefix = "maibuk plugin config "): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** The aliases keyed by `find`, for exact lookups. */
function aliasMap(maibukRoot: string): Map<string | RegExp, string> {
  return new Map(
    externalAliases(maibukRoot).map((entry) => [entry.find, entry.replacement] as const)
  );
}

describe("externalAliases()", () => {
  it("maps the SDK entry and each public subpath to the checkout", () => {
    const aliases = aliasMap(MAIBUK_ROOT);

    expect(aliases.get("@maibuk/plugin-sdk")).toBe(join(MAIBUK_ROOT, "src/plugin-sdk/index.ts"));
    for (const name of ["ui", "ui-serve", "ui-table", "worker-ui", "protocol", "api.generated"]) {
      expect(aliases.get(`@maibuk/plugin-sdk/${name}`)).toBe(
        join(MAIBUK_ROOT, "src/plugin-sdk", name)
      );
    }
  });

  it("maps the test kit, the internal @ alias, and React to Maibuk's copy", () => {
    const aliases = aliasMap(MAIBUK_ROOT);

    expect(aliases.get("@maibuk/plugin-test-kit")).toBe(
      join(MAIBUK_ROOT, "src/features/plugins/test-kit.ts")
    );
    expect(aliases.get("@")).toBe(join(MAIBUK_ROOT, "src"));
    expect(aliases.get("react")).toBe(join(MAIBUK_ROOT, "node_modules/react"));
    expect(aliases.get("react-dom")).toBe(join(MAIBUK_ROOT, "node_modules/react-dom"));
  });

  it("lists a subpath alias before the SDK entry so the first match wins", () => {
    const finds = externalAliases(MAIBUK_ROOT).map((entry) => entry.find);

    expect(finds.indexOf("@maibuk/plugin-sdk/ui")).toBeLessThan(
      finds.indexOf("@maibuk/plugin-sdk")
    );
  });

  it("keeps a root path with spaces intact", () => {
    for (const entry of externalAliases(MAIBUK_ROOT)) {
      expect(entry.replacement).toContain("maibuk checkout");
      expect(entry.replacement).not.toContain("\\ ");
    }
  });
});

describe("testFallbackResolver()", () => {
  it("is a pre plugin named for the checkout fallback", () => {
    const plugin = testFallbackResolver(REAL_MAIBUK_ROOT);

    expect(plugin.name).toBe("maibuk-plugin-test-fallback");
    expect(plugin.enforce).toBe("pre");
    expect(typeof plugin.resolveId).toBe("function");
  });

  it("resolves an allowlisted bare specifier from the checkout when nothing else does", async () => {
    const root = tempDir();
    const plugin = testFallbackResolver(REAL_MAIBUK_ROOT);
    const resolveId = plugin.resolveId as unknown as (
      this: { resolve: () => Promise<null> },
      source: string,
      importer: string,
      options: Record<string, unknown>
    ) => Promise<{ id: string } | null>;
    const context = { resolve: async () => null };

    const vitest = await resolveId.call(context, "vitest", join(root, "index.test.ts"), {});
    expect(vitest?.id).toContain("vitest");

    // A relative specifier is never the fallback's business.
    expect(await resolveId.call(context, "./helper", join(root, "index.test.ts"), {})).toBeNull();
  });
});

describe("tsconfigForCheck()", () => {
  it("mirrors Maibuk's compiler options with the Plugin's paths and baseUrl", () => {
    const config = tsconfigForCheck(PLUGIN_ROOT, MAIBUK_ROOT) as {
      compilerOptions: Record<string, unknown>;
      include: string[];
    };
    const { compilerOptions } = config;

    expect(compilerOptions.target).toBe("ES2020");
    expect(compilerOptions.strict).toBe(true);
    expect(compilerOptions.noEmit).toBe(true);
    // TypeScript 7 removed `baseUrl`; the paths are absolute.
    expect(compilerOptions).not.toHaveProperty("baseUrl");
    expect(config.include).toEqual([
      "../**/*.ts",
      "../**/*.tsx",
      join(MAIBUK_ROOT, "src/**/*.d.ts"),
    ]);
  });

  it("maps the public entries, React's declarations, and a Plugin-only `*` fallback", () => {
    const paths = (
      tsconfigForCheck(PLUGIN_ROOT, MAIBUK_ROOT) as {
        compilerOptions: { paths: Record<string, string[]> };
      }
    ).compilerOptions.paths;

    expect(paths["@maibuk/plugin-sdk"]).toEqual([join(MAIBUK_ROOT, "src/plugin-sdk/index.ts")]);
    expect(paths["@maibuk/plugin-sdk/ui"]).toEqual([join(MAIBUK_ROOT, "src/plugin-sdk/ui.tsx")]);
    expect(paths["@maibuk/plugin-test-kit"]).toEqual([
      join(MAIBUK_ROOT, "src/features/plugins/test-kit.ts"),
    ]);
    expect(paths["@/*"]).toEqual([join(MAIBUK_ROOT, "src/*")]);
    expect(paths.react).toEqual([join(MAIBUK_ROOT, "node_modules/@types/react")]);
    expect(paths["react/jsx-runtime"]).toEqual([
      join(MAIBUK_ROOT, "node_modules/@types/react/jsx-runtime"),
    ]);
    // The fallback lists only the Plugin's own `node_modules`, so a miss falls
    // back to ordinary resolution for the checkout's own deep dependencies.
    expect(paths["*"]).toEqual([join(PLUGIN_ROOT, "node_modules/*")]);
  });
});

describe("tsconfigPaths()", () => {
  it("holds only paths and types for the editor", () => {
    const config = tsconfigPaths(PLUGIN_ROOT, MAIBUK_ROOT) as {
      compilerOptions: Record<string, unknown>;
    };

    expect(Object.keys(config)).toEqual(["compilerOptions"]);
    expect(Object.keys(config.compilerOptions)).toEqual(["paths", "types"]);
    expect(config.compilerOptions.types).toEqual(["node", "react", "react-dom"]);
    expect((config.compilerOptions.paths as Record<string, string[]>)["@/*"]).toEqual([
      join(MAIBUK_ROOT, "src/*"),
    ]);
  });
});

describe("writeGeneratedConfigs()", () => {
  it("writes both configs into <plugin>/.maibuk/ with spaces intact", async () => {
    const pluginRoot = join(tempDir(), "my plugin");
    mkdirSync(pluginRoot, { recursive: true });

    const { checkConfigPath, pathsConfigPath } = await writeGeneratedConfigs(
      pluginRoot,
      MAIBUK_ROOT
    );

    expect(checkConfigPath).toBe(join(pluginRoot, ".maibuk/tsconfig.check.json"));
    expect(pathsConfigPath).toBe(join(pluginRoot, ".maibuk/tsconfig.paths.json"));
    expect(JSON.parse(readFileSync(checkConfigPath, "utf8"))).toEqual(
      tsconfigForCheck(pluginRoot, MAIBUK_ROOT)
    );
    expect(JSON.parse(readFileSync(pathsConfigPath, "utf8"))).toEqual(
      tsconfigPaths(pluginRoot, MAIBUK_ROOT)
    );
  });
});
