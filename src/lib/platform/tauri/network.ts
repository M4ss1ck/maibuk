import { fetch } from "@tauri-apps/plugin-http";
import type { PluginFetchAdapter } from "@/lib/platform/types";

/**
 * The http plugin's `fetch`, run by Rust outside the webview, so no CORS
 * applies. The broker's host check is the only gate a Plugin passes.
 *
 * The plugin ignores the standard `redirect` option the shared request sets;
 * `maxRedirections: 0` is what turns redirect following off in its Rust client
 * (`reqwest::redirect::Policy::none()`). Without it the Rust client would
 * follow a redirect and send an injected secret header to another host.
 */
export const tauriPluginFetch: PluginFetchAdapter = (url, init) =>
  fetch(url, { ...init, maxRedirections: 0 });
