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
 * The Frame gate's rule (#454, D6), over one Tauri platform string (or null)
 * and the committed Windows record: the Frame is off on Android, where v1 runs
 * no Plugin at all (#447), and off on Windows until a manual WebView2 Frame
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
