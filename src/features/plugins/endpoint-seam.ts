/**
 * The E2E lane's one way to hand the Plugin Endpoint a request (#586).
 *
 * Playwright drives the production web build, which has no socket: the Rust
 * listener and its Host, Origin, 421 and 403 rules are proven by the tests in
 * `src-tauri/src/plugins/endpoint.rs`. What the web build can prove is the host
 * side of the route, so this module puts `dispatchEndpointRequest` on `window`
 * and the `@wf:plugins-endpoint` spec calls it against a fixture Plugin running
 * in the real sandbox, Worker, and broker.
 *
 * It reads the same live lookups the supervisor does — the lifecycle's runtimes
 * and the device's approvals — so a Plugin only answers when it is running,
 * enabled, and was granted `serve`; anything else is the host's own 404, exactly
 * as a real request gets.
 *
 * The web build also has no bound port, so {@link setSeamEndpointPort} records
 * the listener state the address derives from, the way the desktop supervisor
 * records it after binding. That is how the MCP Server page's snippets get an
 * address, and how `@wf:plugins-mcp-server` moves it to see the reconnect
 * notice; the lifecycle turns each move into `endpoint.addressChanged`.
 *
 * Nothing here reaches a shipped bundle: `main.tsx` reads
 * `VITE_E2E_BUILTIN_SEED` inline (the flag only the E2E lane's build sets), so a
 * normal build folds the guard to false, drops the dynamic import, and never
 * emits this module.
 */

import { getPluginApproval } from "@/features/plugins/approvals";
import { collectEndpointAnswer, dispatchEndpointRequest } from "@/features/plugins/endpoint";
import { getPluginLifecycle } from "@/features/plugins/lifecycle-instance";
import { usePluginManagementStore } from "@/features/plugins/management";
import { bytesToBase64 } from "@/plugin-sdk/protocol";

/** One request the seam hands the Plugin Endpoint. */
export interface EndpointSeamRequest {
  /** The HTTP method; defaults to `GET`. */
  method?: string;
  /** The full path on the Endpoint, `/plugin/<pluginId>/…`, query included. */
  path: string;
  /** Request headers, duplicates kept in order. */
  headers?: [string, string][];
  /** The request body as UTF-8 text; omitted for no body. */
  body?: string;
}

/** The answer one seam request produced. */
export interface EndpointSeamAnswer {
  status: number;
  /** Response headers, duplicates kept in order. */
  headers: [string, string][];
  /** The streamed pieces, decoded, in order; empty when the answer was whole. */
  chunks: string[];
  /** The whole body: the answer's own bytes, or every streamed chunk joined. */
  text: string;
}

declare global {
  interface Window {
    __maibukEndpointSeam?: (
      pluginId: string,
      request: EndpointSeamRequest
    ) => Promise<EndpointSeamAnswer>;
    __maibukEndpointAddressSeam?: (port: number | null) => void;
  }
}

/** Request ids only have to differ within one page; the broker keys its map by them. */
let nextRequestId = 1;

/**
 * Routes one request through the app's real dispatcher and resolves with the
 * whole answer: a streamed one settles on its `end`, a whole one on its reply.
 * The text is decoded once from the whole body, and the chunks through one
 * streaming decoder, so a character that straddles two chunks stays intact.
 */
export async function dispatchSeamEndpointRequest(
  pluginId: string,
  request: EndpointSeamRequest
): Promise<EndpointSeamAnswer> {
  const answer = await collectEndpointAnswer((sink) => {
    dispatchEndpointRequest(
      {
        runtime: (id) => getPluginLifecycle()?.runtime(id) ?? null,
        approval: (id) => getPluginApproval(id),
      },
      {
        requestId: String(nextRequestId++),
        pluginId,
        request: {
          method: request.method ?? "GET",
          path: request.path,
          headers: [...(request.headers ?? [])],
          body: bytesToBase64(
            request.body === undefined ? new Uint8Array() : new TextEncoder().encode(request.body)
          ),
        },
      },
      sink
    );
  });
  const chunkDecoder = new TextDecoder();
  return {
    status: answer.status,
    headers: answer.headers,
    chunks: answer.chunks.map((chunk) => chunkDecoder.decode(chunk, { stream: true })),
    text: new TextDecoder().decode(answer.body),
  };
}

/**
 * Records the listener state the Plugin Endpoint's address derives from, as
 * the desktop supervisor would after binding a port. The web build has no
 * socket, so the address the MCP Server page shows — and the move that raises
 * `endpoint.addressChanged` — is driven from here. `null` unbinds it.
 */
export function setSeamEndpointPort(port: number | null): void {
  usePluginManagementStore
    .getState()
    .setEndpoint(port === null ? { state: "off" } : { state: "listening", port });
}

/** Puts the seam on the page. Only the E2E lane's build calls this. */
export function installEndpointSeam(): void {
  window.__maibukEndpointSeam = dispatchSeamEndpointRequest;
  window.__maibukEndpointAddressSeam = setSeamEndpointPort;
}
