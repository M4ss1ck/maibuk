import type { EndpointAdapter } from "@/lib/platform/types";

/**
 * The Plugin Endpoint on the web build and on Android: there is no HTTP socket
 * to bind (the web's sandbox has `connect-src 'none'`, and the Rust listener is
 * desktop-only), so the listener stays off and never delivers a request. The
 * host still asks, so the state it shows matches every platform.
 */
export const webPluginEndpoint: EndpointAdapter = {
  async sync() {
    return { state: "off" };
  },
  async respond() {},
  async chunk() {
    return false;
  },
  async end() {},
};
