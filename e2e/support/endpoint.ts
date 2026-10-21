// Drives the Plugin Endpoint's host side through the E2E lane's test-only seam
// (#586). Playwright drives the production web build, which has no socket, so
// the spec hands one request to the app's real `dispatchEndpointRequest` through
// `window.__maibukEndpointSeam` (`src/features/plugins/endpoint-seam.ts`, installed
// only in the E2E lane's build). The socket and its Host/Origin/421/403 rules are
// proven by the Rust tests in `src-tauri/src/plugins/endpoint.rs`. Setup-only,
// like the storage helpers: a spec asserts on the answer it returns.

import type { Page } from "@playwright/test";
import type { EndpointSeamAnswer } from "@/features/plugins/endpoint-seam";

/**
 * The answer one seam request produced, as the seam declares it: one type for
 * both sides, so the spec cannot assert a shape the app stopped producing.
 */
export type EndpointAnswer = EndpointSeamAnswer;

/** One seam request: the method, the path, and optionally headers and a body. */
export interface EndpointRequestInit {
  method?: string;
  /** Request headers, duplicates kept in order. */
  headers?: [string, string][];
  /** The body as UTF-8 text. */
  body?: string;
}

interface EndpointSeamWindow {
  __maibukEndpointSeam?: (
    pluginId: string,
    request: { method: string; path: string; headers: [string, string][]; body?: string }
  ) => Promise<EndpointAnswer>;
  __maibukEndpointAddressSeam?: (port: number | null) => void;
}

/**
 * Waits for the seam the E2E build installs, then hands the Plugin Endpoint one
 * request for `pluginId` on `path` (the full `/plugin/<pluginId>/…` path).
 */
export async function dispatchEndpoint(
  page: Page,
  pluginId: string,
  path: string,
  method = "GET",
  init: Omit<EndpointRequestInit, "method"> = {}
): Promise<EndpointAnswer> {
  await page.waitForFunction(() => {
    const seam = (window as unknown as EndpointSeamWindow).__maibukEndpointSeam;
    return typeof seam === "function";
  });
  return page.evaluate(
    ({ pluginId, path, method, headers, body }) => {
      const seam = (window as unknown as EndpointSeamWindow).__maibukEndpointSeam;
      if (seam === undefined) throw new Error("the Plugin Endpoint seam is not installed");
      return seam(pluginId, { method, path, headers, body });
    },
    { pluginId, path, method, headers: init.headers ?? [], body: init.body }
  );
}

/**
 * Records the listener state the Plugin Endpoint's address derives from, as
 * the desktop supervisor would after binding a port. The web build has no
 * socket, so this is how a spec gives the address to a Plugin that holds
 * `serve`, and how it moves the address to prove the reconnect notice. `null`
 * unbinds it.
 */
export async function setEndpointAddress(page: Page, port: number | null): Promise<void> {
  await page.waitForFunction(() => {
    const seam = (window as unknown as EndpointSeamWindow).__maibukEndpointAddressSeam;
    return typeof seam === "function";
  });
  await page.evaluate((next) => {
    const seam = (window as unknown as EndpointSeamWindow).__maibukEndpointAddressSeam;
    if (seam === undefined) throw new Error("the Plugin Endpoint address seam is not installed");
    seam(next);
  }, port);
}
