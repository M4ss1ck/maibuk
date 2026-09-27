// PROTOTYPE. The voice-dictation spike page, built with Maibuk's own Vite
// config (plugins, worker.format "es", aliases) so the bundling result is the
// one the real web build would get. Serves COOP/COEP, which the threaded
// Moonshine WASM needs for SharedArrayBuffer.
import { resolve } from "node:path";
import { defineConfig, mergeConfig } from "vite";
import base from "../../vite.config";

const isolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig((env) =>
  mergeConfig(typeof base === "function" ? base(env) : base, {
    root: __dirname,
    publicDir: resolve(__dirname, "public"),
    resolve: {
      alias: { moonshine: resolve(__dirname, "vendor/moonshine-wasm/dist/index.js") },
    },
    server: { port: 5199, strictPort: true, headers: isolation },
    preview: { port: 5198, strictPort: true, headers: isolation },
    build: { outDir: resolve(__dirname, "dist"), emptyOutDir: true },
  }),
);
