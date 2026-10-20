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
 * Nothing here reaches a shipped bundle: `main.tsx` reads
 * `VITE_E2E_BUILTIN_SEED` inline (the flag only the E2E lane's build sets), so a
 * normal build folds the guard to false, drops the dynamic import, and never
 * emits this module.
 */

import { getPluginApproval } from "@/features/plugins/approvals";
import { dispatchEndpointRequest } from "@/features/plugins/endpoint";
import { getPluginLifecycle } from "@/features/plugins/lifecycle-instance";
import { base64ToBytes, bytesToBase64 } from "@/plugin-sdk/protocol";

/** One request the seam hands the Plugin Endpoint. */
export interface EndpointSeamRequest {
  /** The HTTP method; defaults to `GET`. */
  method?: string;
  /** The full path on the Endpoint, `/plugin/<pluginId>/…`, query included. */
  path: string;
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
  }
}

/** Request ids only have to differ within one page; the broker keys its map by them. */
let nextRequestId = 1;

/**
 * Routes one request through the app's real dispatcher and resolves with the
 * whole answer: a streamed one settles on its `end`, a whole one on its reply.
 */
export function dispatchSeamEndpointRequest(
  pluginId: string,
  request: EndpointSeamRequest
): Promise<EndpointSeamAnswer> {
  const decoder = new TextDecoder();
  return new Promise((resolve) => {
    let status = 0;
    let headers: [string, string][] = [];
    let streaming = false;
    const chunks: string[] = [];
    let whole = "";
    let settled = false;

    const settle = () => {
      if (settled) return;
      settled = true;
      resolve({
        status,
        headers,
        chunks: [...chunks],
        text: streaming ? chunks.join("") : whole,
      });
    };

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
          headers: [],
          body: bytesToBase64(new Uint8Array()),
        },
      },
      {
        respond(nextStatus, nextHeaders, body, nextStreaming) {
          status = nextStatus;
          headers = nextHeaders;
          streaming = nextStreaming;
          if (nextStreaming) return;
          whole = body === undefined ? "" : decoder.decode(base64ToBytes(body));
          settle();
        },
        chunk(chunk) {
          chunks.push(decoder.decode(base64ToBytes(chunk)));
          return true;
        },
        end() {
          settle();
        },
      }
    );
  });
}

/** Puts the seam on the page. Only the E2E lane's build calls this. */
export function installEndpointSeam(): void {
  window.__maibukEndpointSeam = dispatchSeamEndpointRequest;
}
