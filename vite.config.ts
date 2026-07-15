/// <reference types="vitest/config" />

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
import { version } from "./package.json";

const host = process.env.TAURI_DEV_HOST;
const buildTarget = process.env.VITE_BUILD_TARGET || "tauri";
const isWeb = buildTarget === "web";

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  worker: {
    format: "es" as const,
  },
  define: {
    __APP_VERSION__: JSON.stringify(`v${version}`),
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/test/**/*.test.ts", "src/test/**/*.test.tsx"],
    coverage: {
      provider: "v8" as const,
      reporter: ["text", "html", "lcov"] as ("text" | "html" | "lcov")[],
      include: [
        // Phase 1: Pure logic (export pipeline, crypto, i18n, constants)
        "src/features/export/html-sanitizer.ts",
        "src/features/export/pdf-generator.ts",
        "src/features/export/pdf-styles.ts",
        "src/features/export/epub-styles.ts",
        "src/features/export/epub-generator.ts",
        "src/features/sync/crypto.ts",
        "src/i18n.ts",
        "src/constants.ts",
        // Phase 2: Stores + hooks
        "src/features/books/store.ts",
        "src/features/chapters/store.ts",
        "src/features/notes/store.ts",
        "src/features/settings/store.ts",
        "src/features/settings/toolbar-config.ts",
        "src/features/theme/store.ts",
        "src/features/sync/store.ts",
        "src/hooks/useAutoSave.ts",
        "src/features/version/useVersionCheck.ts",
        // Phase 3: UI components
        "src/components/ui/Button.tsx",
        "src/components/ui/Input.tsx",
        "src/components/ui/Modal.tsx",
        "src/components/ui/Select.tsx",
        "src/components/ui/Switch.tsx",
        "src/components/ui/Toast.tsx",
        "src/components/ui/Combobox.tsx",
        "src/components/ui/MultiSelectCombobox.tsx",
        // Phase 4: Integration (routing, providers, layout)
        "src/components/LoadingScreen.tsx",
        "src/components/PathTracker.tsx",
        "src/components/ThemeProvider.tsx",
        "src/components/ThemeToggle.tsx",
        "src/components/StartupRedirect.tsx",
        "src/components/Layout.tsx",
        "src/components/RouteAnnouncer.tsx",
        // Phase 5: Backup + sync safety
        "src/features/backup/backup-service.ts",
        "src/features/backup/generate-sql-dump.ts",
        "src/features/backup/lifecycle.ts",
        "src/lib/db/sql-parser.ts",
        "src/lib/db/index.ts",
        "src/lib/platform/tauri/backup.ts",
        "src/lib/platform/web/backup.ts",
        "src/features/sync/sync-engine.ts",
        "src/features/sync/client.ts",
        "src/features/sync/tombstones.ts",
        // Phase 6: Editor extensions
        "src/components/editor/html-schema-validator.ts",
        "src/components/editor/paste-cleanup.ts",
        "src/components/editor/PagePaddingControl.tsx",
        "src/components/editor/WidthControl.tsx",
        "src/components/editor/text-transforms.ts",
        "src/components/editor/toolbar/toolbar-groups.ts",
        "src/components/editor/toolbar/useToolbarOverflow.ts",
        "src/components/editor/extensions/scene-break-utils.ts",
        "src/components/editor/extensions/SceneBreak.ts",
        "src/features/export/pdf-content-renderer.tsx",
        // Phase 7: Version control
        "src/features/versions/store.ts",
        "src/features/versions/useAutoCheckpoint.ts",
        "src/features/versions/sanitize.ts",
        "src/features/versions/compare.ts",
        "src/components/versions/HistoryMenuButton.tsx",
        "src/lib/platform/detect.ts",
        // Phase 8: Writing metrics infrastructure
        "src/features/metrics/word-count.ts",
        "src/features/metrics/classifier.ts",
        "src/features/metrics/events-repo.ts",
        "src/features/metrics/settings.ts",
        "src/features/metrics/purge.ts",
        "src/features/metrics/aggregates/compute.ts",
        "src/features/metrics/metrics-sync.ts",
        "src/components/settings/MetricsSection.tsx",
        "src/pages/Metrics.tsx",
        "src/lib/metrics/MetricsService.ts",
        // Phase 9: EPUB import
        "src/features/import/types.ts",
        "src/features/import/epub-reader.ts",
        "src/features/import/epub-scanner.ts",
        "src/features/import/project-assets-repo.ts",
        "src/features/import/epub-project-repo.ts",
        "src/features/import/epub-normalizer.ts",
        "src/features/import/epub-import-service.ts",
        "src/features/import/xhtml-to-editor.ts",
        // Phase 10: Project-aware export
        "src/features/export/project-epub-generator.ts",
        // Phase 11: Persistent accordion state
        "src/features/notes/store.ts",
        "src/features/sync/serializer.ts",
        "src/components/editor/extensions/CollapsibleHeading.ts",
        // Phase 12: Settings ASCII easter egg
        "src/components/settings/asciiBanner.helpers.ts",
        "src/components/settings/AsciiBanner.tsx",
        "src/components/settings/AsciiFieldBackground.tsx",
        "src/features/settings/AppSettingsProvider.tsx",
        // Phase 13: Infinite Canvas
        "src/features/canvas/serialization.ts",
        "src/features/canvas/reactFlowAdapter.ts",
        "src/features/canvas/store.ts",
        // Phase 14: Canvas rich-text parity
        "src/components/editor/extensions/createRichTextExtensions.ts",
        "src/components/editor/plain-text-html.ts",
        "src/features/canvas/nodes/staticRichText.ts",
      ],
      exclude: ["src/**/*.d.ts"],
      thresholds: {
        lines: 85,
        functions: 90,
        statements: 85,
        branches: 70,
      },
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
