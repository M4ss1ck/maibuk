// The web half of the dictation conformance lane. It builds the harness with
// Maibuk's own Vite config (plugins, worker.format "es", the `@` and
// `moonshine-wasm` aliases) so the bundling result is the one the real web
// build gets, with this directory as root. `web.mjs` serves the built page with
// the same COOP/COEP headers the root config serves, which the threaded
// Moonshine WASM needs for SharedArrayBuffer.
import { resolve } from "node:path";
import { defineConfig, mergeConfig } from "vite";
import base from "../../vite.config";

export default defineConfig((env) => {
  const baseConfig = typeof base === "function" ? base(env) : base;
  // Reuse the root config's isolation headers verbatim rather than redefine
  // them (the spike's own `require-corp` value is not what the app serves).
  const isolation = baseConfig.preview?.headers ?? {
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "credentialless",
  };
  return mergeConfig(baseConfig, {
    root: __dirname,
    publicDir: false,
    server: { port: 5197, strictPort: true, headers: isolation },
    preview: { port: 5197, strictPort: true, headers: isolation },
    build: {
      outDir: resolve(__dirname, "../../vendor/moonshine/conformance/harness-dist"),
      emptyOutDir: true,
      rollupOptions: { input: resolve(__dirname, "harness.html") },
    },
  });
});
