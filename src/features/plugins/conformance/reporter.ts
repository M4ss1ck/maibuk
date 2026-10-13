/**
 * The collector client (#447, D3). The route auto-runs on load and reports to a
 * Node collector the `conformance:plugins` lane starts on `127.0.0.1:8787`:
 * one `/progress` per check as it settles, then `/result` with the engine and
 * the whole list, then `/done`. It also posts `/heartbeat`, the host-side proof
 * T8's renderer survived (D4).
 *
 * A missing or slow collector must never break the page: every call swallows
 * its error. `heartbeat()` is the one call whose failure is meaningful — it
 * returns false when the POST cannot go out, and T8 reads that as a dead
 * renderer.
 */

import type { ConformanceCheck, ConformanceResult } from "@/features/plugins/conformance/types";

/** The collector origin the lane binds (D3); a fixed constant, not configurable. */
export const CONFORMANCE_COLLECTOR_BASE_URL = "http://127.0.0.1:8787";

/**
 * The collector contract (#447, D3/D4). The route posts these paths on
 * `CONFORMANCE_COLLECTOR_BASE_URL`; the `conformance:plugins` lane's Node
 * collector (D5) must serve them. Exported so the runner unit imports the same
 * paths instead of repeating the strings.
 */
export const CONFORMANCE_COLLECTOR_PATHS = {
  /** `POST` one `ConformanceCheck` as it settles. */
  progress: "/progress",
  /** `POST` the whole `ConformanceResult`. */
  result: "/result",
  /** `POST` an empty body once the run is over. */
  done: "/done",
  /** `POST` an empty body after T8, the proof the host renderer survived. */
  heartbeat: "/heartbeat",
  /** `GET` the requests the collector logged from the Plugin, as `{ count }`. */
  leaks: "/leaks",
} as const;

/** The `/leaks` reply. */
export interface ConformanceCollectorLeaks {
  count: number;
}

export interface ConformanceReporter {
  /** One check, posted as it settles. */
  progress(check: ConformanceCheck): Promise<void>;
  /** The whole run: the engine and every check. */
  result(payload: ConformanceResult): Promise<void>;
  /** The run is over. */
  done(): Promise<void>;
  /** The host heartbeat after T8; false when the POST could not go out. */
  heartbeat(): Promise<boolean>;
  /** The collector's request count since the run began; 0 when it cannot say. */
  leaks(): Promise<number>;
}

export function createReporter(
  base: string = CONFORMANCE_COLLECTOR_BASE_URL,
  fetchImpl: typeof fetch = fetch
): ConformanceReporter {
  const paths = CONFORMANCE_COLLECTOR_PATHS;
  async function post(path: string, body?: unknown): Promise<boolean> {
    try {
      await fetchImpl(`${base}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return true;
    } catch {
      return false;
    }
  }

  return {
    async progress(check) {
      await post(paths.progress, check);
    },
    async result(payload) {
      await post(paths.result, payload);
    },
    async done() {
      await post(paths.done);
    },
    heartbeat() {
      return post(paths.heartbeat);
    },
    async leaks() {
      try {
        const response = await fetchImpl(`${base}${paths.leaks}`);
        if (!response) return 0;
        const data = (await response.json()) as Partial<ConformanceCollectorLeaks>;
        return typeof data.count === "number" ? data.count : 0;
      } catch {
        return 0;
      }
    },
  };
}
