import type { PluginFetchAdapter } from "@/lib/platform/types";

/**
 * The browser's own `fetch`. A request is subject to CORS exactly as any page
 * request is, and a refusal reaches the Plugin as a typed network error. The
 * broker has already decided the host is allowed.
 */
export const webPluginFetch: PluginFetchAdapter = (url, init) => globalThis.fetch(url, init);
