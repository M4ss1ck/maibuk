/// <reference types="vitest/config" />

import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { version } from "./package.json";
import { TEST_TIMEOUT_MS } from "./src/test/time-budget";

const host = process.env.TAURI_DEV_HOST;
const buildTarget = process.env.VITE_BUILD_TARGET || "tauri";
const isWeb = buildTarget === "web";
// The Android QuickJS engine is the only build that carries the runner Worker
// bundle and its Wasm (#516); every other platform runs Plugins natively.
const isAndroidBuild = process.env.TAURI_ENV_PLATFORM === "android";

/**
 * Keeps the Android QuickJS engine's assets out of every non-Android build
 * (#516). `host-assets.ts` imports the runner with `?worker&url` and the Wasm
 * with `?url`; Vite emits those assets as soon as it loads the module, and
 * Rollup loads a dynamic import's target even when the importing branch is
 * statically false. So the flag alone drops the code but still leaves an orphan
 * runner Worker and a QuickJS `.wasm` in `dist/`. Resolving the loader to an
 * empty module on other platforms means those imports are never loaded, and the
 * assets are never emitted. `runtime.ts` reaches the loader only through the
 * flag-guarded dynamic import, which is dead on those builds.
 */
function quickJsEngineAndroidOnly(): Plugin {
  const STUB_ID = "\0maibuk:quickjs-host-assets-stub";
  return {
    name: "maibuk-quickjs-engine-android-only",
    enforce: "pre",
    resolveId(id) {
      if (isAndroidBuild) return null;
      if (id === "@/features/plugins/quickjs/host-assets" || id.endsWith("/quickjs/host-assets")) {
        return STUB_ID;
      }
      return null;
    },
    load(id) {
      if (id === STUB_ID) return "export {};";
      return null;
    },
  };
}

/**
 * Serves the Built-in Plugin build output (`dist/plugins/`) at `/plugins/`
 * during development. The app fetches `plugins/index.json` and each shipped file
 * relative to the app base (`src/features/plugins/builtin.ts`); a Release build
 * serves them from `dist/`, but the dev server serves the project root, so
 * without this the fetch falls through to the SPA fallback and the app ships no
 * Built-ins. Both dev lanes build the Plugins into that folder before Vite
 * starts (`pnpm tauri dev` and `pnpm dev:web`; see `plugins/README.md`
 * "Building"), so the folder is current once per dev start, never per HMR change.
 */
function builtInPluginsDevServe(): Plugin {
  const pluginsDir = resolve(__dirname, "dist/plugins");
  const contentTypes: Record<string, string> = {
    ".json": "application/json; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".svg": "image/svg+xml",
    ".wasm": "application/wasm",
    ".txt": "text/plain; charset=utf-8",
    ".map": "application/json; charset=utf-8",
  };
  return {
    name: "maibuk-builtin-plugins-dev-serve",
    apply: "serve",
    configureServer(server) {
      // Registered during `configureServer`, so it runs before Vite's internal
      // middlewares and the SPA fallback.
      server.middlewares.use((req, res, next) => {
        if (req.method !== "GET" && req.method !== "HEAD") return next();
        const path = decodeURIComponent((req.url ?? "").split("?")[0] ?? "");
        if (!path.startsWith("/plugins/")) return next();
        const file = join(pluginsDir, normalize(path.slice("/plugins/".length)));
        // Confine to the build output: a path that escapes the folder is not ours.
        if (file !== pluginsDir && !file.startsWith(pluginsDir + sep)) return next();
        const stat = (() => {
          try {
            return statSync(file);
          } catch {
            return null;
          }
        })();
        if (stat === null || !stat.isFile()) return next();
        res.setHeader(
          "Content-Type",
          contentTypes[extname(file).toLowerCase()] ?? "application/octet-stream"
        );
        res.setHeader("Content-Length", stat.size);
        if (req.method === "HEAD") {
          res.end();
          return;
        }
        createReadStream(file).pipe(res);
      });
    },
  };
}

/**
 * Makes the QuickJS runner Worker a single self-contained module (#516). Vite
 * builds every Worker entry with `preserveEntrySignatures: false`, which drops a
 * pure re-export and would emit `worker-entry.ts` as an empty runner; the runner
 * also splits its `quickjs-emscripten` dynamic imports into sibling chunks. The
 * sandbox Worker imports the runner from a `blob:` URL, where a relative
 * `import("./chunk.js")` cannot resolve, so this keeps that one entry's export
 * and inlines its dynamic imports. Every other Worker is a side-effect script
 * with no exports and is left untouched.
 */
function quickJsRunnerWorkerBundle(): Plugin {
  let isRunnerEntry = false;
  return {
    name: "maibuk-quickjs-runner-worker",
    options(options) {
      isRunnerEntry =
        typeof options.input === "string" && options.input.includes("quickjs/worker-entry");
      return isRunnerEntry ? { ...options, preserveEntrySignatures: "strict" } : null;
    },
    outputOptions(options) {
      if (!isRunnerEntry) return null;
      return { ...options, inlineDynamicImports: true };
    },
  };
}

// Cross-origin isolation for threaded Dictation (SharedArrayBuffer). Matches
// public/_headers in production; the E2E suite runs against `vite preview`, so
// it inherits isolation from the `preview` block too.
const isolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
};

// https://vite.dev/config/
export default defineConfig(() => ({
  envPrefix: ["VITE_", "TAURI_ENV_"],
  plugins: [quickJsEngineAndroidOnly(), react(), tailwindcss(), builtInPluginsDevServe()],
  resolve: {
    alias: [
      { find: "@", replacement: resolve(__dirname, "src") },
      {
        find: /^moonshine-wasm$/,
        replacement: resolve(__dirname, "vendor/moonshine/wasm/dist/index.js"),
      },
      {
        find: /^moonshine-wasm\/(.*)$/,
        replacement: resolve(__dirname, "vendor/moonshine/wasm/dist/$1"),
      },
    ],
  },
  worker: {
    format: "es" as const,
    plugins: () => [quickJsRunnerWorkerBundle()],
  },
  define: {
    __APP_VERSION__: JSON.stringify(`v${version}`),
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    alias: [
      {
        find: /^sql\.js\/dist\/sql-wasm\.wasm\?url$/,
        replacement: resolve(__dirname, "src/test/support/sql-wasm-url.ts"),
      },
    ],
    include: [
      "src/test/**/*.test.ts",
      "src/test/**/*.test.tsx",
      "plugins/**/*.test.ts",
      "plugins/**/*.test.tsx",
    ],
    // One budget for every test; see src/test/time-budget.ts.
    testTimeout: TEST_TIMEOUT_MS,
    hookTimeout: TEST_TIMEOUT_MS,
    reporters: ["default", "./src/test/support/time-budget-reporter.ts"],
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
        "src/features/settings/accent-color.ts",
        "src/features/settings/app-language.ts",
        "src/features/dictation/catalog.ts",
        "src/features/dictation/crc32c.ts",
        "src/features/dictation/interpreter.ts",
        "src/features/dictation/normalize.ts",
        "src/features/dictation/spoken-punctuation.ts",
        "src/features/dictation/voice-commands.ts",
        "src/features/dictation/vocabulary.ts",
        "src/features/dictation/model-store.ts",
        "src/features/dictation/router.ts",
        "src/features/dictation/stats.ts",
        "src/features/dictation/hub.ts",
        "src/features/dictation/runtime.ts",
        "src/features/dictation/language.ts",
        "src/features/dictation/session.ts",
        "src/features/dictation/store.ts",
        "src/features/dictation/usePhraseRecording.ts",
        "src/lib/color.ts",
        "src/components/editor/plain-text-offsets.ts",
        "src/features/settings/toolbar-config.ts",
        "src/features/theme/store.ts",
        "src/features/sync/store.ts",
        "src/hooks/useAutoSave.ts",
        "src/hooks/usePluginSecrets.ts",
        "src/hooks/useItemContextMenu.ts",
        "src/hooks/useParkSelectionWhileDragging.ts",
        "src/lib/park-selection.ts",
        "src/features/releases/release-notes.ts",
        "src/features/releases/release-check.ts",
        "src/features/releases/compare.ts",
        "src/components/releases/ReleaseNotesDialog.tsx",
        "src/components/releases/ReleaseBadge.tsx",
        // Phase 3: UI components
        "src/components/ui/Button.tsx",
        "src/components/ui/ColorPickerControl.tsx",
        "src/components/cover-editor/panels/PaintControl.tsx",
        "src/components/ui/Input.tsx",
        "src/components/ui/Modal.tsx",
        "src/components/ui/Select.tsx",
        "src/components/ui/Switch.tsx",
        "src/components/ui/Checkbox.tsx",
        "src/components/ui/Toast.tsx",
        "src/components/ui/Combobox.tsx",
        "src/components/ui/MultiSelectCombobox.tsx",
        "src/components/ui/ItemActionsMenu.tsx",
        "src/components/dictation/PhraseRecording.tsx",
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
        "src/features/backup/utils.ts",
        "src/features/backup/generate-sql-dump.ts",
        "src/features/backup/lifecycle.ts",
        "src/lib/window/androidLifecycle.ts",
        "src/lib/checksum.ts",
        "src/lib/db/sql-parser.ts",
        "src/lib/db/atomic.ts",
        "src/lib/db/index.ts",
        "src/lib/db/compact.ts",
        "src/lib/platform/tauri/backup.ts",
        "src/lib/platform/tauri/database.ts",
        "src/lib/platform/web/backup.ts",
        "src/lib/platform/web/database.ts",
        "src/features/sync/sync-engine.ts",
        "src/features/sync/client.ts",
        "src/features/sync/tombstones.ts",
        "src/lib/async-queue.ts",
        // Plugin storage (ADR 0023)
        "src/features/plugins/tables.ts",
        "src/features/plugins/storage.ts",
        // Plugin secrets and network (ADR 0023, #453)
        "src/features/plugins/secret-store.ts",
        "src/features/plugins/network.ts",
        "src/lib/platform/web/secrets.ts",
        "src/lib/platform/tauri/secrets.ts",
        "src/lib/platform/web/network.ts",
        "src/lib/platform/tauri/network.ts",
        "src/lib/platform/web/clipboard.ts",
        "src/lib/platform/tauri/clipboard.ts",
        // Plugin manifest (ADR 0022)
        "src/features/plugins/semver.ts",
        "src/features/plugins/manifest-schema.ts",
        "src/features/plugins/manifest-validate.ts",
        "src/features/plugins/manifest-compat.ts",
        "src/features/plugins/api-table.ts",
        "src/features/plugins/api-codegen.ts",
        "src/features/plugins/broker.ts",
        "src/features/plugins/directory-hash.ts",
        "src/features/plugins/modules.ts",
        "src/features/plugins/sandbox.ts",
        "src/features/plugins/runtime.ts",
        "src/features/plugins/lifecycle.ts",
        "src/features/plugins/approvals.ts",
        "src/features/plugins/launch.ts",
        "src/features/plugins/review.ts",
        "src/features/plugins/management.ts",
        "src/features/plugins/builtin.ts",
        "src/features/plugins/handlers.ts",
        "src/features/plugins/library.ts",
        "src/features/plugins/navigation.ts",
        "src/features/plugins/editor-host.ts",
        "src/features/plugins/language.ts",
        "src/features/plugins/test-kit.ts",
        "src/lib/platform/web/plugins.ts",
        "src/lib/platform/tauri/plugins.ts",
        "src/plugin-sdk/index.ts",
        "src/plugin-sdk/protocol.ts",
        // Remote UI host renderer (ADR 0021, #438)
        "src/plugin-sdk/ui-table.ts",
        "src/plugin-sdk/ui.tsx",
        "src/features/plugins/ui-codegen.ts",
        "src/features/plugins/remote-ui/css-scope.ts",
        "src/features/plugins/remote-ui/echo.ts",
        "src/features/plugins/remote-ui/validate.ts",
        "src/features/plugins/remote-ui/receiver.ts",
        "src/features/plugins/remote-ui/components.tsx",
        "src/features/plugins/remote-ui/surface.tsx",
        "src/features/plugins/remote-ui/use-plugin-remote-ui.ts",
        "src/features/plugins/remote-ui/mount.ts",
        "src/features/plugins/remote-ui/boundary.tsx",
        "src/plugin-sdk/ui-serve.tsx",
        "src/plugin-sdk/worker-ui.tsx",
        // Phase 6: Editor extensions
        "src/components/editor/html-schema-validator.ts",
        "src/components/editor/paste-cleanup.ts",
        "src/components/editor/PagePaddingControl.tsx",
        "src/components/editor/WidthControl.tsx",
        "src/components/editor/text-transforms.ts",
        "src/components/editor/toolbar/toolbar-groups.ts",
        "src/components/editor/toolbar/editor-toolbar-state.ts",
        "src/components/editor/toolbar/useToolbarOverflow.ts",
        "src/components/editor/extensions/scene-break-utils.ts",
        "src/components/editor/extensions/SceneBreak.ts",
        "src/components/editor/extensions/AutoClose.ts",
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
        "src/features/sync/sync-codec.ts",
        "src/features/sync/sync-codec-handlers.ts",
        "src/features/sync/change-feed.ts",
        "src/features/sync/view-refresh.ts",
        "src/features/sync/auto-sync.ts",
        "src/features/sync/entity-sync.ts",
        "src/features/sync/remote-port.ts",
        "src/features/books/store.ts",
        "src/features/books/write.ts",
        "src/features/chapters/store.ts",
        "src/features/chapters/write.ts",
        "src/features/notes/write.ts",
        "src/lib/db/sql-export.ts",
        "src/lib/db/sql-export-format.ts",
        "src/components/editor/extensions/CollapsibleHeading.ts",
        // Phase 12: Settings ASCII easter egg
        "src/components/settings/asciiBanner.helpers.ts",
        "src/components/settings/AsciiBanner.tsx",
        "src/components/settings/AsciiFieldBackground.tsx",
        "src/features/settings/outline.ts",
        "src/features/settings/outline-edge.ts",
        "src/components/settings/SettingsSection.tsx",
        "src/components/settings/SettingsOutline.tsx",
        "src/components/settings/SettingsSectionMenu.tsx",
        "src/components/settings/SettingsOutlineLayout.tsx",
        "src/components/settings/useSettingsOutline.ts",
        "src/features/settings/AppSettingsProvider.tsx",
        // Phase 13: Infinite Canvas
        "src/features/canvas/serialization.ts",
        "src/features/canvas/reactFlowAdapter.ts",
        "src/features/canvas/store.ts",
        "src/features/canvas/write.ts",
        // Phase 14: Canvas rich-text parity
        "src/components/editor/extensions/createRichTextExtensions.ts",
        "src/components/editor/plain-text-html.ts",
        "src/features/canvas/nodes/staticRichText.ts",
        // Symbols
        "src/features/symbols/names.ts",
        "src/features/symbols/search.ts",
        "src/features/symbols/store.ts",
        "src/features/symbols/load.ts",
        "src/components/editor/SymbolsDialog.tsx",
        "src/components/editor/SymbolSuggestion.tsx",
        "src/components/editor/extensions/SymbolAutocomplete.ts",
        "src/components/editor/SelectionToolbar.tsx",
        "src/components/editor/extensions/SelectionKept.ts",
        "scripts/symbols-data/transform.ts",
        // Built-in Plugin build lane (issue #444): the pure build, target, and
        // bundle-size logic.
        "scripts/build-builtin-plugins.ts",
        // Plugin tooling (issue #455): the CLI, the generated configs, the
        // shared file listing, and the boundary, layout, and package checks,
        // each with a unit test. `steps.ts` is deliberately absent: only the
        // slow lane exercises it.
        "scripts/plugin/cli.ts",
        "scripts/plugin/config.ts",
        "scripts/plugin/files.ts",
        "scripts/plugin/import-boundary.ts",
        "scripts/plugin/layout.ts",
        "scripts/plugin/package.ts",
        // Echoes Built-in Plugin (issue #449): the analyzer and the find logic.
        "plugins/maibuk-echoes/find-echoes.ts",
        "plugins/maibuk-echoes/language.ts",
        // Frame-rate lane (issue #372): the pure Frame Report, budget, and parsers.
        "src/test/support/frames/frame-report.ts",
        "src/test/support/frames/attribution.ts",
        "src/test/support/frames/budget.ts",
        "src/test/support/frames/bench-report.ts",
        "src/test/support/frames/cli.ts",
        "src/test/support/frames/scenarios.ts",
        "src/test/support/frames/sources/*.ts",
        // Plugin conformance lane (issue #447): the host platform rule, the
        // check runner and its per-check leak attribution, the collector
        // client, and the lane's pure parts (the version gate and the
        // collector/report helpers). `seam.ts` and `ConformancePage.tsx` are
        // deliberately absent: only the native lane exercises them (the real
        // sandbox, Worker, broker, and lifecycle), and no Vitest test reaches
        // them. `fixture.ts`, `run.ts`, and `index.ts` are on that same
        // native-only path.
        "src/features/plugins/host-platform.ts",
        "src/features/plugins/windows-frame-record.ts",
        "src/features/plugins/conformance/checks.ts",
        "src/features/plugins/conformance/commands.ts",
        "src/features/plugins/conformance/host-bypass.ts",
        "src/features/plugins/conformance/oom-grace.ts",
        "src/features/plugins/conformance/reporter.ts",
        "src/features/plugins/conformance/types.ts",
        "src/test/support/plugin-conformance/android-target.ts",
        "src/test/support/plugin-conformance/args.ts",
        "src/test/support/plugin-conformance/collector-state.ts",
        "src/test/support/plugin-conformance/csp.ts",
        "src/test/support/plugin-conformance/report.ts",
        "src/test/support/plugin-conformance/wait.ts",
        "scripts/plugin-conformance-gate.mjs",
        // Plugins bench lane (issue #448): the marks gate and the driver's pure
        // measurement primitives and seed shape. `driver.ts`, `seed.ts`,
        // `protocol.ts`, and `index.ts` are deliberately absent: the gated
        // WebKitGTK driver only runs inside the real app and no Vitest test
        // reaches them.
        "src/lib/bench-marks.ts",
        "src/features/plugins/bench/measure.ts",
        "src/features/plugins/bench/types.ts",
        // Deep-link / strict link-uri
        "src/features/links/link-uri.ts",
        "src/features/links/navigate.ts",
        "src/features/deep-link/resolve.ts",
        "src/features/links/resolve-target.ts",
        "src/features/links/link-preview.ts",
        "src/features/deep-link/bridge.ts",
        // Tutorial (issue #189)
        "src/features/tutorial/library-switch.ts",
        "src/features/tutorial/tutorial-library.ts",
        "src/features/tutorial/sample-library.ts",
        "src/features/tutorial/sections.ts",
        "src/features/tutorial/store.ts",
        "src/features/tutorial/controller.ts",
        "src/lib/db/memory-database.ts",
        "src/components/tutorial/TutorialCard.tsx",
        "src/components/tutorial/TutorialRunner.tsx",
        "src/components/tutorial/TutorialIllustration.tsx",
        "src/components/tutorial/TutorialOffer.tsx",
        "src/components/settings/TutorialSection.tsx",
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

  // Absolute asset URLs: with a relative base, reloading a nested route such
  // as /book/:id resolves assets under /book/ and the SPA fallback answers
  // the module requests with index.html.
  base: "/",

  preview: {
    headers: isolation,
  },

  // Only apply Tauri-specific options when building for Tauri
  ...(isWeb
    ? {
        server: {
          headers: isolation,
        },
      }
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
          headers: isolation,
        },
      }),
}));
