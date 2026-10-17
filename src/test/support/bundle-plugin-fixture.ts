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

const cache = new Map<string, Promise<string>>();

let viteModule: Promise<typeof import("vite")> | null = null;
let esbuildRealmRepaired = false;

/**
 * Load Vite exactly once, repairing the jsdom realm first. The jsdom suite
 * (`renderPage`) bundles fixtures too, and vitest's jsdom environment replaces
 * `globalThis.Uint8Array` with jsdom's own realm's class. esbuild's load-time
 * invariant (`new TextEncoder().encode("") instanceof Uint8Array`) and its
 * binary IPC both fail on that mismatch, so the host intrinsic the host
 * `TextEncoder` produces is put back for the process. A `// @vitest-environment
 * node` suite already matches and is left untouched.
 */
function loadVite(): Promise<typeof import("vite")> {
  if (viteModule === null) {
    repairUint8ArrayRealm();
    viteModule = import("vite");
  }
  return viteModule;
}

function repairUint8ArrayRealm(): void {
  if (esbuildRealmRepaired) return;
  esbuildRealmRepaired = true;
  const globals = globalThis as { Uint8Array: Uint8ArrayConstructor };
  const hostUint8Array = new TextEncoder().encode("").constructor as Uint8ArrayConstructor;
  if (hostUint8Array !== globals.Uint8Array) globals.Uint8Array = hostUint8Array;
}

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
  const { build } = await loadVite();
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
