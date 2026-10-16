/**
 * Bundles one Plugin fixture entry into one self-contained ESM string through
 * the app's own Vite pipeline, so the QuickJS runner suite evaluates exactly the
 * bytes a shipped Plugin bundles: the real SDK, tree-shaken, with no imports
 * left. The result is cached per entry, so a suite builds each fixture once.
 *
 * The entry is a Plugin source under `src/test/`; it imports `@/plugin-sdk` like
 * any Plugin and, like any Plugin, must be self-contained once built.
 */

import { resolve } from "node:path";
import { build } from "vite";

const cache = new Map<string, Promise<string>>();

/** One Rollup output chunk; the only shape this helper reads. */
interface BundleChunk {
  type: string;
  code?: string;
}

interface BundleOutput {
  output: BundleChunk[];
}

function isBundleOutput(value: unknown): value is BundleOutput {
  return (
    typeof value === "object" && value !== null && Array.isArray((value as BundleOutput).output)
  );
}

/** Bundle the Plugin entry at `entry` (an absolute path) into one ESM string. */
export function bundlePluginFixture(entry: string): Promise<string> {
  let bundled = cache.get(entry);
  if (!bundled) {
    bundled = bundle(entry);
    cache.set(entry, bundled);
  }
  return bundled;
}

async function bundle(entry: string): Promise<string> {
  const raw = await build({
    configFile: false,
    logLevel: "warn",
    publicDir: false,
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    resolve: {
      alias: [{ find: "@", replacement: resolve(process.cwd(), "src") }],
    },
    esbuild: { jsx: "automatic", jsxDev: false },
    build: {
      write: false,
      minify: false,
      target: "es2020",
      lib: { entry, formats: ["es"], fileName: () => "fixture.js" },
      rollupOptions: {
        external: [],
        // A UI-free Plugin must not carry the SDK's Remote UI modules, which
        // extend DOM classes at module scope (`CustomEvent`) and cannot even
        // evaluate in QuickJS. Treating modules as side-effect-free lets Rollup
        // drop every SDK module the fixture does not use; the entry's own
        // top-level code is always kept.
        treeshake: { moduleSideEffects: false },
        output: { inlineDynamicImports: true },
      },
    },
  });
  const outputs: unknown[] = Array.isArray(raw) ? raw : [raw];
  const output = outputs.find(isBundleOutput);
  if (!output) throw new Error(`fixture build for ${entry} produced no output`);
  const chunk = output.output.find((piece) => piece.type === "chunk");
  if (!chunk?.code) throw new Error(`fixture build for ${entry} produced no chunk`);
  return chunk.code;
}
