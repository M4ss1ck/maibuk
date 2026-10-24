/**
 * The configuration an external Plugin is built, tested, and typechecked with
 * (issue #455). Every function here is pure and returns plain data, so the
 * values are easy to test: {@link externalAliases} and
 * {@link testFallbackResolver} are what the build and the test run resolve the
 * SDK, the test kit, and React through, and {@link tsconfigForCheck} /
 * {@link tsconfigPaths} are the two TypeScript configs the typecheck step reads.
 * The only writer is {@link writeGeneratedConfigs}, which puts both generated
 * configs into `<plugin>/.maibuk/` (GITIGNORED, the editor's and tsc's copy).
 *
 * The division of labour is fixed by the plan: a Plugin resolves its own
 * dependencies from its own `node_modules` first, React is always pinned to
 * Maibuk's single copy (one React per renderer), and the test-only fallback
 * only steps in for the packages a Plugin never installs itself (Vitest, the
 * Testing Library, React). This module imports no `@/` code, so the E2E global
 * setup, which loads the build through Playwright's JSON-refusing ESM loader,
 * can import it too.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { Alias, Plugin } from "vite";

/** The public Plugin SDK package: `<maibuk>/src/plugin-sdk/index.ts`. */
export const SDK_PACKAGE = "@maibuk/plugin-sdk";

/** The public Plugin test kit: `<maibuk>/src/features/plugins/test-kit.ts`. */
export const TEST_KIT_PACKAGE = "@maibuk/plugin-test-kit";

/**
 * The SDK's public subpath entries. Each maps to `<maibuk>/src/plugin-sdk/<name>`
 * in Vite and to the file with its real extension in the TypeScript paths.
 */
const SDK_SUBPATHS = [
  { name: "ui", file: "ui.tsx" },
  { name: "ui-serve", file: "ui-serve.tsx" },
  { name: "ui-table", file: "ui-table.ts" },
  { name: "worker-ui", file: "worker-ui.tsx" },
  { name: "protocol", file: "protocol.ts" },
  { name: "api.generated", file: "api.generated.ts" },
] as const;

/**
 * The bare specifiers the test-only fallback resolver serves from Maibuk's
 * `node_modules` when the Plugin's own resolution fails. React is pinned by
 * {@link externalAliases} before this ever runs; it is listed so a Plugin that
 * reaches a React subpath the alias does not cover still resolves.
 */
const TEST_FALLBACK_PACKAGES = ["vitest", "@testing-library/", "react", "react-dom"] as const;

/** The ambient type packages the editor config includes; React's are runtime types. */
const PLUGIN_TYPES = ["node", "react", "react-dom"] as const;

/**
 * The `@testing-library/jest-dom` Vitest matcher declarations
 * (`toBeInTheDocument`, `toHaveFocus`, ...). Maibuk's own suite loads them from
 * `src/test/setup.ts` (`import "@testing-library/jest-dom/vitest"`), which the
 * Plugin's program never includes, so the tooling points at the same
 * declaration file directly. It is a path, not a `types` entry: a Plugin has no
 * `node_modules` for `types` to resolve the package from, and `paths` does not
 * apply to `types`.
 */
const JEST_DOM_VITEST_TYPES = "node_modules/@testing-library/jest-dom/types/vitest.d.ts";

/**
 * The Vite aliases an external Plugin resolves through: the SDK and its public
 * subpaths, the test kit, `@` (so the SDK and kit's own `@/` imports resolve,
 * never the Plugin's own), and React. Ordered most specific first, because the
 * first matching entry wins; a Plugin importing `@/...` itself is refused by the
 * import-boundary check, not by resolution.
 */
export function externalAliases(maibukRoot: string): Alias[] {
  const src = join(maibukRoot, "src");
  const modules = join(maibukRoot, "node_modules");
  return [
    ...SDK_SUBPATHS.map(({ name }) => ({
      find: `${SDK_PACKAGE}/${name}`,
      replacement: join(src, "plugin-sdk", name),
    })),
    { find: SDK_PACKAGE, replacement: join(src, "plugin-sdk", "index.ts") },
    { find: TEST_KIT_PACKAGE, replacement: join(src, "features", "plugins", "test-kit.ts") },
    { find: "@", replacement: src },
    { find: "react-dom", replacement: join(modules, "react-dom") },
    { find: "react", replacement: join(modules, "react") },
  ];
}

/** Whether a bare specifier is one the test-only fallback resolver owns. */
function isTestFallbackPackage(specifier: string): boolean {
  return TEST_FALLBACK_PACKAGES.some(
    (prefix) =>
      specifier === prefix ||
      (prefix.endsWith("/") ? specifier.startsWith(prefix) : specifier.startsWith(`${prefix}/`))
  );
}

/**
 * The test-only resolver: if a bare specifier in the allowlist fails to resolve
 * from the importing file, it resolves from Maibuk's checkout. `enforce: "pre"`
 * puts it before Vitest's own resolvers, and it defers to the normal pipeline
 * (`skipSelf`) whenever that already resolves the specifier, so a Plugin's own
 * `node_modules` still wins.
 */
export function testFallbackResolver(maibukRoot: string): Plugin {
  const requireFromMaibuk = createRequire(join(maibukRoot, "package.json"));
  return {
    name: "maibuk-plugin-test-fallback",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (importer === undefined || !isTestFallbackPackage(source)) return null;
      let resolved: unknown = null;
      try {
        resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      } catch {
        resolved = null;
      }
      if (resolved) return null;
      try {
        return { id: requireFromMaibuk.resolve(source) };
      } catch {
        return null;
      }
    },
  };
}

/** Every TypeScript path an external Plugin typechecks and edits against. */
function pluginPaths(pluginRoot: string, maibukRoot: string): Record<string, string[]> {
  const src = join(maibukRoot, "src");
  const modules = join(maibukRoot, "node_modules");
  const types = join(modules, "@types");
  const paths: Record<string, string[]> = {};
  for (const { name, file } of SDK_SUBPATHS) {
    paths[`${SDK_PACKAGE}/${name}`] = [join(src, "plugin-sdk", file)];
  }
  paths[SDK_PACKAGE] = [join(src, "plugin-sdk", "index.ts")];
  paths[TEST_KIT_PACKAGE] = [join(src, "features", "plugins", "test-kit.ts")];
  paths["@/*"] = [join(src, "*")];
  // React and the test-only packages a Plugin never installs itself, pinned to
  // Maibuk's copy. React's declarations come from `@types/react*`: the package
  // ships none of its own, and `react/jsx-runtime` / `react-dom/client` need
  // their own entries (a bare `react` path does not cover a subpath).
  paths.react = [join(types, "react")];
  paths["react-dom"] = [join(types, "react-dom")];
  paths["react/jsx-runtime"] = [join(types, "react", "jsx-runtime")];
  paths["react-dom/client"] = [join(types, "react-dom", "client")];
  paths.vitest = [join(modules, "vitest")];
  paths["@testing-library/*"] = [join(modules, "@testing-library", "*")];
  // The true fallback: a bare specifier nothing else matched is looked up in
  // the Plugin's own `node_modules` first. When that misses, TypeScript falls
  // back to ordinary node resolution, so the SDK and test kit's own deep
  // dependencies (PostCSS's `lib/tokenize`, `drizzle-kit`, …) still resolve through
  // their `exports` maps from the checkout.
  paths["*"] = [join(pluginRoot, "node_modules", "*")];
  return paths;
}

/** Maibuk's own `compilerOptions`, mirrored so the Plugin checks under the same rules. */
const MIRRORED_COMPILER_OPTIONS = {
  target: "ES2020",
  useDefineForClassFields: true,
  lib: ["ES2020", "DOM", "DOM.Iterable"],
  module: "ESNext",
  skipLibCheck: true,
  moduleResolution: "bundler",
  allowImportingTsExtensions: true,
  resolveJsonModule: true,
  isolatedModules: true,
  noEmit: true,
  jsx: "react-jsx",
  strict: true,
  noUnusedLocals: true,
  noUnusedParameters: true,
  noFallthroughCasesInSwitch: true,
} as const;

/**
 * The `<plugin>/.maibuk/tsconfig.check.json` object the typecheck step runs
 * `tsc -p` against: Maibuk's compiler options and paths, every `.ts`/`.tsx`
 * under the Plugin root, and Maibuk's ambient declarations (`src/vite-env.d.ts`,
 * `src/types/*.d.ts`) so `import.meta.env` and the PostCSS tokenizer module are
 * typed exactly as they are in the checkout.
 *
 * TypeScript 7 removed `baseUrl`, so the paths are absolute and resolved
 * relative to nothing.
 */
export function tsconfigForCheck(pluginRoot: string, maibukRoot: string): Record<string, unknown> {
  return {
    compilerOptions: {
      ...MIRRORED_COMPILER_OPTIONS,
      paths: pluginPaths(pluginRoot, maibukRoot),
    },
    include: [
      "../**/*.ts",
      "../**/*.tsx",
      join(maibukRoot, "src", "**/*.d.ts"),
      join(maibukRoot, JEST_DOM_VITEST_TYPES),
    ],
  };
}

/**
 * The `<plugin>/.maibuk/tsconfig.paths.json` object the Plugin's own
 * `tsconfig.json` extends for the editor: `paths`, `types` (TypeScript 7
 * removed `baseUrl`), and `files` naming the `@testing-library/jest-dom` Vitest
 * matcher declarations the editor needs. `files` is not overridden when the
 * Plugin's `tsconfig.json` sets its own `include`, so the matcher types stay in
 * the editor's program.
 */
export function tsconfigPaths(pluginRoot: string, maibukRoot: string): Record<string, unknown> {
  return {
    compilerOptions: {
      paths: pluginPaths(pluginRoot, maibukRoot),
      types: [...PLUGIN_TYPES],
    },
    files: [join(maibukRoot, JEST_DOM_VITEST_TYPES)],
  };
}

/** Where {@link writeGeneratedConfigs} wrote each generated config. */
export interface GeneratedConfigs {
  /** `<plugin>/.maibuk/tsconfig.check.json`. */
  checkConfigPath: string;
  /** `<plugin>/.maibuk/tsconfig.paths.json`. */
  pathsConfigPath: string;
}

/**
 * Writes both generated TypeScript configs into `<plugin>/.maibuk/` (created
 * when missing) and returns their paths.
 */
export async function writeGeneratedConfigs(
  pluginRoot: string,
  maibukRoot: string
): Promise<GeneratedConfigs> {
  const dir = join(pluginRoot, ".maibuk");
  await mkdir(dir, { recursive: true });
  const checkConfigPath = join(dir, "tsconfig.check.json");
  const pathsConfigPath = join(dir, "tsconfig.paths.json");
  await writeFile(
    checkConfigPath,
    `${JSON.stringify(tsconfigForCheck(pluginRoot, maibukRoot), null, 2)}\n`
  );
  await writeFile(
    pathsConfigPath,
    `${JSON.stringify(tsconfigPaths(pluginRoot, maibukRoot), null, 2)}\n`
  );
  return { checkConfigPath, pathsConfigPath };
}
