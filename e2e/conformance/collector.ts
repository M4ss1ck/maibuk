// The conformance lane's collector (#447, D5): a `node:http` server on
// 127.0.0.1:8787 that serves the in-page reporter's contract (reporter.ts) and
// logs every request the sandboxed Plugin should not have been able to make.
//
// All routing and counting rules live in the pure reducer
// (`src/test/support/plugin-conformance/collector-state.ts`); this file is the
// socket shell: read the body, fold the request, answer with CORS headers so the
// app document can POST cross-origin, and print a line for every Plugin leak.

import { createServer, type IncomingMessage, type Server } from "node:http";

import { CONFORMANCE_COLLECTOR_ORIGIN } from "@/test/support/plugin-conformance/csp";
import {
  type CollectorState,
  applyCollectorRequest,
  initialCollectorState,
} from "@/test/support/plugin-conformance/collector-state";

/** The host the collector binds. */
export const CONFORMANCE_COLLECTOR_HOST = "127.0.0.1";
/** The port the collector binds, fixed by the in-page reporter's contract. */
export const CONFORMANCE_COLLECTOR_PORT = 8787;

/** A running collector: the app posts to `url`, the runner reads its state. */
export interface ConformanceCollector {
  url: string;
  /** The requests seen since the last `reset()`. */
  state(): CollectorState;
  /** Forgets a previous platform's run before the next launch. */
  reset(): void;
  close(): Promise<void>;
}

function readBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolveBody) => {
    let data = "";
    request.on("data", (chunk) => {
      data += chunk;
    });
    request.on("end", () => {
      if (data === "") return resolveBody(undefined);
      try {
        resolveBody(JSON.parse(data));
      } catch {
        resolveBody(undefined);
      }
    });
    request.on("error", () => resolveBody(undefined));
  });
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

/**
 * Starts the collector, refusing (rejecting) when 127.0.0.1:8787 is taken. The
 * caller treats that as a prerequisite it cannot measure.
 */
export function startConformanceCollector(): Promise<ConformanceCollector> {
  return new Promise((resolveServer, reject) => {
    let current = initialCollectorState();
    const server: Server = createServer((request, response) => {
      void readBody(request).then((body) => {
        const { state, reply } = applyCollectorRequest(current, {
          method: request.method ?? "GET",
          path: request.url ?? "",
          body,
        });
        if (state.leaks > current.leaks) {
          console.warn(
            `[conformance] Plugin leak: ${request.method} ${request.url} (leaks: ${state.leaks})`
          );
        }
        current = state;
        const headers = reply.status === 204 ? CORS : { ...CORS, "content-type": "application/json" };
        response.writeHead(reply.status, headers);
        response.end(reply.body === undefined ? undefined : JSON.stringify(reply.body));
      });
    });
    // A WebSocket upgrade (the fixture's `ws://.../socket`) reaches no route
    // handler, so it is folded here; the reducer counts it as a leak.
    server.on("upgrade", (request, socket) => {
      const { state } = applyCollectorRequest(current, {
        method: "GET",
        path: request.url ?? "",
      });
      if (state.leaks > current.leaks) {
        console.warn(`[conformance] Plugin leak: GET ${request.url} (WebSocket upgrade)`);
      }
      current = state;
      socket.destroy();
    });
    server.once("error", reject);
    server.listen(CONFORMANCE_COLLECTOR_PORT, CONFORMANCE_COLLECTOR_HOST, () => {
      server.removeListener("error", reject);
      resolveServer({
        url: CONFORMANCE_COLLECTOR_ORIGIN,
        state: () => current,
        reset: () => {
          current = initialCollectorState();
        },
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}
