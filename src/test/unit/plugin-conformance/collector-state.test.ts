import { describe, expect, it } from "vitest";

import { CONFORMANCE_COLLECTOR_PATHS } from "@/features/plugins/conformance/reporter";
import type { ConformanceCheck } from "@/features/plugins/conformance/types";
import {
  CONFORMANCE_COLLECTOR_CONTRACT,
  type CollectorState,
  applyCollectorRequest,
  initialCollectorState,
  isPluginLeak,
} from "@/test/support/plugin-conformance/collector-state";

const PASS: ConformanceCheck = { id: "T2-worker-ipc", status: "pass", detail: "no IPC" };
const FAIL: ConformanceCheck = { id: "T7-hang", status: "fail", detail: "not stopped" };

function fold(requests: Parameters<typeof applyCollectorRequest>[1][]): CollectorState {
  return requests.reduce(
    (state, request) => applyCollectorRequest(state, request).state,
    initialCollectorState()
  );
}

describe("CONFORMANCE_COLLECTOR_CONTRACT", () => {
  it("is the reporter's contract, method and path", () => {
    expect(CONFORMANCE_COLLECTOR_CONTRACT).toEqual([
      { method: "POST", path: CONFORMANCE_COLLECTOR_PATHS.progress },
      { method: "POST", path: CONFORMANCE_COLLECTOR_PATHS.result },
      { method: "POST", path: CONFORMANCE_COLLECTOR_PATHS.done },
      { method: "POST", path: CONFORMANCE_COLLECTOR_PATHS.heartbeat },
      { method: "GET", path: CONFORMANCE_COLLECTOR_PATHS.leaks },
    ]);
  });
});

describe("isPluginLeak()", () => {
  it("does not count the contract paths", () => {
    for (const entry of CONFORMANCE_COLLECTOR_CONTRACT) {
      expect(isPluginLeak(entry)).toBe(false);
    }
  });

  it("never counts a CORS preflight, whatever its path", () => {
    expect(isPluginLeak({ method: "OPTIONS", path: "/result" })).toBe(false);
    expect(isPluginLeak({ method: "OPTIONS", path: "/escape" })).toBe(false);
  });

  it("counts an off-contract request, a wrong method, and a WebSocket upgrade", () => {
    expect(isPluginLeak({ method: "GET", path: "/escape" })).toBe(true);
    expect(isPluginLeak({ method: "GET", path: "/socket" })).toBe(true);
    expect(isPluginLeak({ method: "POST", path: "/" })).toBe(true);
    expect(isPluginLeak({ method: "GET", path: "/result" })).toBe(true);
  });
});

describe("applyCollectorRequest()", () => {
  it("collects progress lines in order", () => {
    const state = fold([
      { method: "POST", path: "/progress", body: PASS },
      { method: "POST", path: "/progress", body: FAIL },
    ]);
    expect(state.progress).toEqual([PASS, FAIL]);
  });

  it("records the engine and the whole result", () => {
    const result = { engine: { name: "tauri-webkitgtk", version: "1", userAgent: "UA" }, checks: [PASS] };
    const state = fold([{ method: "POST", path: "/result", body: result }]);
    expect(state.result).toEqual(result);
    expect(state.engine).toEqual(result.engine);
  });

  it("ignores a progress or result body that is not the contract shape", () => {
    const state = fold([
      { method: "POST", path: "/progress", body: { nope: true } },
      { method: "POST", path: "/result", body: 42 },
    ]);
    expect(state.progress).toEqual([]);
    expect(state.result).toBeNull();
  });

  it("marks done and heartbeat", () => {
    const state = fold([
      { method: "POST", path: "/done" },
      { method: "POST", path: "/heartbeat" },
    ]);
    expect(state.done).toBe(true);
    expect(state.heartbeat).toBe(true);
  });

  it("counts a Plugin leak and answers /leaks with the running count", () => {
    const { state } = applyCollectorRequest(initialCollectorState(), {
      method: "GET",
      path: "/escape",
    });
    expect(state.leaks).toBe(1);
    const leaks = applyCollectorRequest(state, { method: "GET", path: "/leaks" });
    expect(leaks.state.leaks).toBe(1);
    expect(leaks.reply).toEqual({ status: 200, body: { count: 1 } });
  });

  it("does not count the reporter's own contract traffic as leaks", () => {
    const state = fold([
      { method: "POST", path: "/progress", body: PASS },
      { method: "POST", path: "/result", body: { engine: { name: "w", version: "1", userAgent: "u" }, checks: [PASS] } },
      { method: "POST", path: "/done" },
      { method: "POST", path: "/heartbeat" },
      { method: "GET", path: "/leaks" },
      { method: "OPTIONS", path: "/result" },
    ]);
    expect(state.leaks).toBe(0);
    expect(state.requests).toBe(6);
  });

  it("answers 404 for an off-contract request", () => {
    const { reply } = applyCollectorRequest(initialCollectorState(), { method: "GET", path: "/nope" });
    expect(reply.status).toBe(404);
  });

  it("answers 204 to the contract POSTs and to a preflight", () => {
    expect(applyCollectorRequest(initialCollectorState(), { method: "POST", path: "/done" }).reply.status).toBe(204);
    expect(applyCollectorRequest(initialCollectorState(), { method: "OPTIONS", path: "/result" }).reply.status).toBe(204);
  });
});
