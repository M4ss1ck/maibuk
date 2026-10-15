/**
 * The one platform rule every Plugin consumer reads: which platforms the Plugin
 * host runs Plugins on.
 *
 * v1 does not run Plugins on Android (#447). On the Android emulator a Worker
 * allocating in yielding chunks grew the WebView renderer to 1.8 GB,
 * lowmemorykiller killed it, and Chromium's `aw_browser_terminator` then killed
 * the whole app (the conformance:plugins T8 result; logcat in #492). A Plugin can
 * therefore take down the Android app, so until a hard memory cap (QuickJS, #492)
 * exists no Plugin — Built-in or added — is listed as runnable, enabled,
 * started, or contributes Commands or panels on Android.
 *
 * This module is a leaf with no runtime imports, so the Built-in build script
 * (run under `tsx`, without Vite's `import.meta.env`) can read
 * {@link pluginsRunOn} without pulling in the Plugin Directory adapters or the
 * management store.
 */

/**
 * The device platforms a Plugin host serves; it mirrors the Plugin Directory
 * adapter's `kind` (`web`, `desktop`, or `android`).
 */
export type PluginHostPlatform = "web" | "desktop" | "android";

/**
 * The platforms the host runs no Plugin on, whatever a manifest declares.
 * Android is unsupported in v1 (#447): the manifest schema still accepts
 * "android" so a published manifest stays valid and forward compatible, but it
 * is ignored here.
 */
export const PLUGIN_HOST_UNSUPPORTED_PLATFORMS: readonly PluginHostPlatform[] = ["android"];

/**
 * True when the host runs Plugins on `platform` at all, the host rule alone. A
 * false answer means no Plugin starts there regardless of its manifest.
 */
export function pluginsRunOn(platform: PluginHostPlatform): boolean {
  return !PLUGIN_HOST_UNSUPPORTED_PLATFORMS.includes(platform);
}

/**
 * The Tauri platform this build runs on, or null when there is none: the web
 * build, and `scripts/build-builtin-plugins.ts` under `tsx`, which has no Vite
 * `import.meta.env`. Read defensively so this leaf stays importable there.
 */
function tauriPlatform(): string | null {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return env?.TAURI_ENV_PLATFORM ?? null;
}

/**
 * The Frame gate's rule, over one Tauri platform string (or null): the Frame is
 * off on Android, where v1 runs no Plugin at all (#447), and on everywhere else
 * today. A later slice adds Windows until a recorded WebView2 conformance run
 * exists. Pure, so a test drives it without the build env.
 */
export function pluginFrameAvailableOn(platform: string | null): boolean {
  return platform !== "android";
}

/**
 * Whether the custom-UI `Frame` may mount on this build (#454, D6). The rest of
 * the Plugin keeps working when this is false: only the Frame refuses and shows
 * the not-available placeholder.
 */
export function isPluginFrameAvailable(): boolean {
  return pluginFrameAvailableOn(tauriPlatform());
}
