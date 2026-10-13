// The conformance collector's request handling as a pure state reducer (#447,
// D5). `e2e/conformance/collector.ts` is a thin `node:http` shell around
// `applyCollectorRequest`: every routing and counting rule lives here, so the
// contract the in-page reporter posts (reporter.ts) and the Plugin-leak rule are
// tested without a socket.
//
// The reporter owns the contract paths; this module imports
// `CONFORMANCE_COLLECTOR_PATHS` from it so the two can never drift. A request
// that is not one of those `method path` pairs is a **Plugin leak**: the
// fixture-hostile Plugin's escapes target the collector, and the sandbox CSP is
// the only thing that should stop them (D4). A CORS preflight (`OPTIONS`) is the
// browser's own, never the Plugin's, so it is never a leak.

import {
  CONFORMANCE_COLLECTOR_PATHS,
} from "@/features/plugins/conformance/reporter";
import type {
  ConformanceCheck,
  ConformanceEngine,
  ConformanceResult,
} from "@/features/plugins/conformance/types";

/** One request the collector received. */
export interface CollectorRequest {
  method: string;
  /** The request path, query included when present. */
  path: string;
  /** The parsed JSON body for the contract POSTs. */
  body?: unknown;
}

/** What the collector has seen since the run began. */
export interface CollectorState {
  engine: ConformanceEngine | null;
  /**
   * The userAgent the first `/progress` or `/result` body carried, or null while
   * none has. The route reports the engine on `/result`; keeping it here too
   * means the lane records the WebView it ran in even when the app dies before
   * `/result` (#447 D1).
   */
  userAgent: string | null;
  /** Every `/progress` check, in arrival order. */
  progress: ConformanceCheck[];
  /** The whole `/result`, once it arrived. */
  result: ConformanceResult | null;
  /** `/done` arrived: the run is over. */
  done: boolean;
  /** `/heartbeat` arrived: the host renderer answered after T8. */
  heartbeat: boolean;
  /** Requests that were not the reporter's contract (Plugin leaks). */
  leaks: number;
  /** Every request received, leaks included. */
  requests: number;
}

/** The collector's reply to one request. */
export interface CollectorReply {
  status: number;
  body?: unknown;
}

/** One entry of the reporter's contract, as `method path`. */
export interface CollectorContractEntry {
  method: "GET" | "POST";
  path: string;
}

/**
 * The contract the in-page reporter posts (D3). Derived from the reporter's
 * exported paths so a change there changes the collector too.
 */
export const CONFORMANCE_COLLECTOR_CONTRACT: readonly CollectorContractEntry[] = [
  { method: "POST", path: CONFORMANCE_COLLECTOR_PATHS.progress },
  { method: "POST", path: CONFORMANCE_COLLECTOR_PATHS.result },
  { method: "POST", path: CONFORMANCE_COLLECTOR_PATHS.done },
  { method: "POST", path: CONFORMANCE_COLLECTOR_PATHS.heartbeat },
  { method: "GET", path: CONFORMANCE_COLLECTOR_PATHS.leaks },
];

export function initialCollectorState(): CollectorState {
  return {
    engine: null,
    userAgent: null,
    progress: [],
    result: null,
    done: false,
    heartbeat: false,
    leaks: 0,
    requests: 0,
  };
}

/**
 * Whether a request is a Plugin leak: not the reporter's contract. A CORS
 * preflight is the browser's, so it never counts; every other off-contract
 * request — the fixture's `/escape` fetch, a WebSocket upgrade to `/socket`, a
 * wrong method on a contract path — does.
 */
export function isPluginLeak(request: Pick<CollectorRequest, "method" | "path">): boolean {
  if (request.method === "OPTIONS") return false;
  return !CONFORMANCE_COLLECTOR_CONTRACT.some(
    (entry) => entry.method === request.method && entry.path === request.path
  );
}

function isCheck(value: unknown): value is ConformanceCheck {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { status?: unknown }).status === "string"
  );
}

function isResult(value: unknown): value is ConformanceResult {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { engine?: unknown }).engine === "object" &&
    (value as { engine?: unknown }).engine !== null &&
    Array.isArray((value as { checks?: unknown }).checks)
  );
}

/**
 * The userAgent a `/progress` or `/result` body carries, or null: `engine.
 * userAgent` on a result, or a top-level `userAgent` on either. The route sends
 * the engine on `/result`; the top-level form keeps the collector open to a
 * progress line carrying it too (#447 D1).
 */
function userAgentOf(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const engine = (value as { engine?: unknown }).engine;
  if (typeof engine === "object" && engine !== null) {
    const fromEngine = (engine as { userAgent?: unknown }).userAgent;
    if (typeof fromEngine === "string" && fromEngine !== "") return fromEngine;
  }
  const direct = (value as { userAgent?: unknown }).userAgent;
  return typeof direct === "string" && direct !== "" ? direct : null;
}

/**
 * Folds one request into the state and returns the reply the collector sends.
 * The state is a fresh object; the caller swaps it in.
 */
export function applyCollectorRequest(
  state: CollectorState,
  request: CollectorRequest
): { state: CollectorState; reply: CollectorReply } {
  const leak = isPluginLeak(request);
  const next: CollectorState = {
    ...state,
    requests: state.requests + 1,
    leaks: leak ? state.leaks + 1 : state.leaks,
    userAgent: state.userAgent ?? userAgentOf(request.body),
  };

  const { method, path } = request;
  const paths = CONFORMANCE_COLLECTOR_PATHS;

  if (method === "OPTIONS") {
    return { state: next, reply: { status: 204 } };
  }
  if (method === "POST" && path === paths.progress) {
    if (isCheck(request.body)) next.progress = [...state.progress, request.body];
    return { state: next, reply: { status: 204 } };
  }
  if (method === "POST" && path === paths.result) {
    if (isResult(request.body)) {
      next.result = request.body;
      next.engine = request.body.engine;
    }
    return { state: next, reply: { status: 204 } };
  }
  if (method === "POST" && path === paths.done) {
    next.done = true;
    return { state: next, reply: { status: 204 } };
  }
  if (method === "POST" && path === paths.heartbeat) {
    next.heartbeat = true;
    return { state: next, reply: { status: 204 } };
  }
  if (method === "GET" && path === paths.leaks) {
    return { state: next, reply: { status: 200, body: { count: next.leaks } } };
  }
  return { state: next, reply: { status: 404, body: { error: "not the conformance contract" } } };
}
