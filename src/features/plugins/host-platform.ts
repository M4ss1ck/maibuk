/**
 * The one platform rule every Plugin consumer reads: which platforms the Plugin
 * host runs Plugins on.
 *
 * Android runs a Plugin only when its manifest lists "android" in `platforms`
 * (#517, see {@link manifestRunsOn}). The Android Plugin host runs each Plugin in
 * a 64 MB capped QuickJS engine inside the sandbox Worker (#492), so a Plugin
 * that exhausts its heap stops with `out-of-memory` and the renderer survives.
 *
 * This module stays a leaf — its imports are the build-time Windows Frame
 * record ({@link WINDOWS_FRAME_RECORD}) and the build-time platform leaf
 * (`src/lib/platform/windows.ts`) — so the Built-in build script (run under
 * `tsx`, without Vite's `import.meta.env`) can read {@link pluginsRunOn}
 * without pulling in the Plugin Directory adapters or the management store.
 */

import {
  WINDOWS_FRAME_RECORD,
  windowsFrameRecordPasses,
  type WindowsFrameRecord,
} from "@/features/plugins/windows-frame-record";
import { IS_WINDOWS, TAURI_PLATFORM } from "@/lib/platform/windows";

/**
 * The device platforms a Plugin host serves; it mirrors the Plugin Directory
 * adapter's `kind` (`web`, `desktop`, or `android`).
 */
export type PluginHostPlatform = "web" | "desktop" | "android";

/**
 * The platforms the host runs no Plugin on, whatever a manifest declares. Empty
 * since #517: Android runs a Plugin once its manifest lists "android" (the
 * memory-capped QuickJS engine, #492). The mechanism stays so a future platform
 * can be refused in one place.
 */
export const PLUGIN_HOST_UNSUPPORTED_PLATFORMS: readonly PluginHostPlatform[] = [];

/**
 * True when the host runs Plugins on `platform` at all, the host rule alone. A
 * false answer means no Plugin starts there regardless of its manifest.
 */
export function pluginsRunOn(platform: PluginHostPlatform): boolean {
  return !PLUGIN_HOST_UNSUPPORTED_PLATFORMS.includes(platform);
}

/**
 * The Plugin Platforms rule (#517), the one place a manifest's `platforms` is
 * read against a device. An omitted list means desktop and web only; a declared
 * list runs only on the platforms it names, so Android needs "android" listed
 * explicitly. The host rule ({@link pluginsRunOn}) is applied first. Every
 * consumer (`isSupported`, contribution registration, the launch scan, the
 * lifecycle start) calls this so the rule cannot drift between them.
 */
export function manifestRunsOn(
  platforms: readonly string[] | undefined,
  platform: PluginHostPlatform
): boolean {
  if (!pluginsRunOn(platform)) return false;
  if (platforms === undefined) return platform === "desktop" || platform === "web";
  return platforms.includes(platform);
}

/**
 * The Frame gate's rule (#454, D6), over one Tauri platform string (or null)
 * and the committed Windows record: the Frame is off on Android (custom Frame UI
 * stays off there even for a Plugin that lists "android", #517), and off on Windows until a manual WebView2 Frame
 * conformance run is recorded and every Frame check in it passed. Windows
 * detection is the Tauri platform string, which is null on the web build: a web
 * build opened in a Windows browser is not gated (the gate is about the WebView2
 * desktop shell). The record is a parameter with a default so a test drives
 * every combination without the build env.
 */
export function pluginFrameAvailableOn(
  platform: string | null,
  windowsRecord: WindowsFrameRecord | null | undefined = WINDOWS_FRAME_RECORD
): boolean {
  if (platform === "android") return false;
  if (platform === "windows") return windowsFrameRecordPasses(windowsRecord);
  return true;
}

/**
 * Whether the custom-UI `Frame` may mount on this build (#454, D6). The rest of
 * the Plugin keeps working when this is false: only the Frame refuses and shows
 * the not-available placeholder. The Windows desktop shell is the shared
 * platform seam (`src/lib/platform/windows.ts`), so this does not re-derive
 * `TAURI_ENV_PLATFORM` on its own.
 */
export function isPluginFrameAvailable(): boolean {
  return pluginFrameAvailableOn(IS_WINDOWS ? "windows" : TAURI_PLATFORM);
}
