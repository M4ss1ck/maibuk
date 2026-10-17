/**
 * Whether this build runs Plugins in the Android QuickJS engine (#516, ADR
 * 0019).
 *
 * This is a compile-time flag, never a runtime one: `VITE_BUILD_TARGET`/the
 * Tauri platform is baked into `import.meta.env` at build time (see
 * `vite.config.ts`: envPrefix includes `TAURI_ENV_`), so on web and desktop this
 * folds to a literal `false` and Rollup drops every branch behind it — the
 * QuickJS runner, its Wasm, and the bundled runner module never reach those
 * bundles. Every Android-only path is written as a dynamic `import()` inside
 * `if (QUICKJS_ENGINE_ENABLED)` so the drop is observable in the bundle.
 *
 * Do not use the runtime PluginHostPlatform for this: conformance's host bypass
 * reports "desktop" on Android on purpose (#447), so that rule says a Plugin
 * runs where the engine does not.
 */

export const QUICKJS_ENGINE_ENABLED = import.meta.env.TAURI_ENV_PLATFORM === "android";
