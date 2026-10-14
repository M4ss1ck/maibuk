// The lanes' `node:http` collectors. The conformance lane (#447, D5) serves the
// in-page reporter's contract (reporter.ts) and logs every request the
// sandboxed Plugin should not have been able to make. The Plugins bench's
// WebKitGTK lane (#448, unit 4b) receives the measurements its in-app driver
// POSTs. Both are the same socket shell over a different reducer.
//
// `startHttpCollector` is that shell: read the body, hand the request to a
// handler, answer with CORS headers so the app document can POST cross-origin.
// `startConformanceCollector` builds the conformance collector on it; the bench
// runner builds its own on it too.

import { createServer, type IncomingMessage, type Server } from "node:http";

import { CONFORMANCE_COLLECTOR_ORIGIN } from "@/test/support/plugin-conformance/csp";
import {
  type CollectorState,
  applyCollectorRequest,
  initialCollectorState,
} from "@/test/support/plugin-conformance/collector-state";

/** The host the conformance collector binds. */
export const CONFORMANCE_COLLECTOR_HOST = "127.0.0.1";
/** The port the conformance collector binds, fixed by the in-page reporter's contract. */
export const CONFORMANCE_COLLECTOR_PORT = 8787;

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

/** One request the collector received. */
export interface HttpCollectorRequest {
  method: string;
  path: string;
  /** The parsed JSON body, when the body parsed. */
  body?: unknown;
}

/** The reply a collector handler sends back. */
export interface HttpCollectorReply {
  status: number;
  body?: unknown;
}

export interface HttpCollector {
  url: string;
  close(): Promise<void>;
}

export interface HttpCollectorOptions {
  /** The port to bind; 0 asks the OS for a free one. */
  port: number;
  host?: string;
  /** Folds one request and returns the reply. */
  handle(request: HttpCollectorRequest): HttpCollectorReply;
  /** A WebSocket upgrade, which reaches no request handler. */
  onUpgrade?(path: string): void;
}

/**
 * Starts a JSON-over-HTTP collector and resolves once it is listening. Rejects
 * when the address is taken; the caller treats that as a prerequisite it cannot
 * measure.
 */
export function startHttpCollector(options: HttpCollectorOptions): Promise<HttpCollector> {
  const host = options.host ?? CONFORMANCE_COLLECTOR_HOST;
  return new Promise((resolveServer, reject) => {
    const server: Server = createServer((request, response) => {
      void readBody(request).then((body) => {
        const reply = options.handle({
          method: request.method ?? "GET",
          path: request.url ?? "",
          ...(body === undefined ? {} : { body }),
        });
        const headers =
          reply.status === 204 ? CORS : { ...CORS, "content-type": "application/json" };
        response.writeHead(reply.status, headers);
        response.end(reply.body === undefined ? undefined : JSON.stringify(reply.body));
      });
    });
    server.on("upgrade", (request, socket) => {
      options.onUpgrade?.(request.url ?? "");
      socket.destroy();
    });
    server.once("error", reject);
    server.listen(options.port, host, () => {
      server.removeListener("error", reject);
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : options.port;
      resolveServer({
        url: `http://${host}:${port}`,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

/** A running collector: the app posts to `url`, the runner reads its state. */
export interface ConformanceCollector {
  url: string;
  /** The requests seen since the last `reset()`. */
  state(): CollectorState;
  /** Forgets a previous platform's run before the next launch. */
  reset(): void;
  close(): Promise<void>;
}

/**
 * Starts the conformance collector, refusing (rejecting) when 127.0.0.1:8787 is
 * taken. The caller treats that as a prerequisite it cannot measure.
 */
export function startConformanceCollector(): Promise<ConformanceCollector> {
  return new Promise((resolveServer, reject) => {
    let current = initialCollectorState();
    startHttpCollector({
      port: CONFORMANCE_COLLECTOR_PORT,
      host: CONFORMANCE_COLLECTOR_HOST,
      handle: (request) => {
        const { state, reply } = applyCollectorRequest(current, request);
        if (state.leaks > current.leaks) {
          console.warn(
            `[conformance] Plugin leak: ${request.method} ${request.path} (leaks: ${state.leaks})`
          );
        }
        current = state;
        return reply;
      },
      // A WebSocket upgrade (the fixture's `ws://.../socket`) reaches no route
      // handler, so it is folded here; the reducer counts it as a leak.
      onUpgrade: (path) => {
        const { state } = applyCollectorRequest(current, { method: "GET", path });
        if (state.leaks > current.leaks) {
          console.warn(`[conformance] Plugin leak: GET ${path} (WebSocket upgrade)`);
        }
        current = state;
      },
    }).then(
      (collector) =>
        resolveServer({
          url: CONFORMANCE_COLLECTOR_ORIGIN,
          state: () => current,
          reset: () => {
            current = initialCollectorState();
          },
          close: collector.close,
        }),
      reject
    );
  });
}
