/// <reference types="vitest/config" />

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { version } from "./package.json";

const host = process.env.TAURI_DEV_HOST;
const buildTarget = process.env.VITE_BUILD_TARGET || "tauri";
const isWeb = buildTarget === "web";

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],
  worker: {
    format: "es" as const,
  },
  define: {
    __APP_VERSION__: JSON.stringify(`v${version}`),
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    coverage: {
      provider: "v8" as const,
      reporter: ["text", "html"] as ("text" | "html")[],
    },
  },

  // Use relative paths for web builds (static hosting)
  base: isWeb ? "./" : "/",

  // Only apply Tauri-specific options when building for Tauri
  ...(isWeb
    ? {}
    : {
      // Vite options tailored for Tauri development
      // 1. prevent Vite from obscuring rust errors
      clearScreen: false,
      // 2. tauri expects a fixed port, fail if that port is not available
      server: {
        port: 1420,
        strictPort: true,
        host: host || false,
        hmr: host
          ? {
            protocol: "ws",
            host,
            port: 1421,
          }
          : undefined,
        watch: {
          // 3. tell Vite to ignore watching `src-tauri`
          ignored: ["**/src-tauri/**"],
        },
      },
    }),
}));
