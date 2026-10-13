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
  readonly TAURI_ENV_PLATFORM: "linux" | "windows" | "macos" | "android" | "ios" | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
