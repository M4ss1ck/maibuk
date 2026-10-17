/**
 * The conformance lane's one explicit bypass of the v1 Android host rule (#447
 * D2/D4; the T8 renderer kill → #492).
 *
 * Before #517 the product rule (`src/features/plugins/host-platform.ts`) ran no
 * Plugin on Android: on the Android emulator a Worker allocating in yielding chunks
 * grew the WebView renderer until lowmemorykiller killed it and Chromium killed
 * the whole app (the conformance:plugins T8 result, #492). The lane is the
 * artifact that proves the renderer behaviour, so it must still MEASURE Android
 * after that rule landed — a rerun is exactly how #492's hard memory cap is
 * checked once it exists.
 *
 * The seam drives the real lifecycle through a `PluginDirectoryAdapter`, and
 * `scanApprovedPlugins` (as does `lifecycle.install`) refuses a directory whose
 * `kind` the host does not run Plugins on. This module hands the seam a kind
 * the host rule accepts on Android, so the real lifecycle scans, starts, and
 * stops the fixture exactly as it does on Linux, while `seam.ts` still reports
 * the true platform to every check. The `contributions` and `isSupported` rules
 * are not on the seam's path (it registers no contributions and reads no
 * manifest platform), so this is the whole bypass.
 *
 * It lives here, inside the flag-gated conformance module
 * (`VITE_PLUGIN_CONFORMANCE=1`, D3): a production build tree-shakes this file
 * out, so the product rule in `host-platform.ts` is never weakened and no
 * shipped bundle carries the bypass. It changes only the directory kind the
 * conformance seam reports; `pluginsRunOn` itself is untouched.
 */

import type { ConformancePlatform } from "@/features/plugins/conformance/types";
import type { PluginDirectoryAdapter } from "@/lib/platform/types";

/**
 * The Plugin Directory `kind` the conformance seam reports for `platform`.
 * The seam reports the desktop kind for Android, so the lifecycle scans and runs
 * the fixture as on Linux whether or not its manifest lists "android" (the
 * Plugin Platforms rule, #517, is not what this lane measures); the checks never
 * read the directory kind again.
 */
export function conformanceDirectoryKind(
  platform: ConformancePlatform
): PluginDirectoryAdapter["kind"] {
  if (platform === "android") return "desktop";
  return platform;
}
