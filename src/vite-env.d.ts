/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BUILD_TARGET: "web" | "tauri" | undefined;
  /** "1" only in the E2E lane's web build (e2e/run-steps.mjs). */
  readonly VITE_E2E_BUILTIN_SEED: "1" | undefined;
  /**
   * "1" only in the test-only Plugin conformance build (#447): it registers the
   * `/__conformance/plugins` route and embeds the fixture-hostile Plugin. Any
   * other value (including unset) leaves the route out of the bundle.
   */
  readonly VITE_PLUGIN_CONFORMANCE?: string;
  /**
   * "1" only in the production `bench:plugins` build (#448): it turns on the
   * User Timing marks behind `benchMarksEnabled()` (`plugin.start:<id>`,
   * `app.gallery.first-render`), which a normal production build leaves out.
   */
  readonly VITE_PLUGIN_BENCH?: string;
  readonly TAURI_ENV_PLATFORM: "linux" | "windows" | "macos" | "android" | "ios" | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
