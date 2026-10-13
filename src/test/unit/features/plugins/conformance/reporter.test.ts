import { describe, expect, it } from "vitest";

import {
  CONFORMANCE_COLLECTOR_BASE_URL,
  CONFORMANCE_COLLECTOR_PATHS,
  createReporter,
} from "@/features/plugins/conformance/reporter";
import type { ConformanceCheck } from "@/features/plugins/conformance/types";

interface Posted {
  url: string;
  method: string | undefined;
  body: unknown;
}

function recordingFetch(): { calls: Posted[]; fetchImpl: typeof fetch } {
  const calls: Posted[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method,
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    });
    return undefined;
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const PASS: ConformanceCheck = { id: "T2-worker-ipc", status: "pass", detail: "no IPC" };
const FAIL: ConformanceCheck = { id: "T7-hang", status: "fail", detail: "crashed" };

describe("createReporter", () => {
  it("exports the collector contract the conformance runner unit imports", () => {
    expect(CONFORMANCE_COLLECTOR_PATHS).toEqual({
      progress: "/progress",
      result: "/result",
      done: "/done",
      heartbeat: "/heartbeat",
      leaks: "/leaks",
    });
  });

  it("posts each progress line, then the result, then done, in order", async () => {
    const { calls, fetchImpl } = recordingFetch();
    const reporter = createReporter(CONFORMANCE_COLLECTOR_BASE_URL, fetchImpl);

    await reporter.progress(PASS);
    await reporter.progress(FAIL);
    await reporter.result({
      engine: { name: "tauri-webkitgtk", version: "v1", userAgent: "UA" },
      checks: [PASS, FAIL],
    });
    await reporter.done();

    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "POST http://127.0.0.1:8787/progress",
      "POST http://127.0.0.1:8787/progress",
      "POST http://127.0.0.1:8787/result",
      "POST http://127.0.0.1:8787/done",
    ]);
    expect(calls[0]?.body).toEqual(PASS);
    expect(calls[1]?.body).toEqual(FAIL);
    expect(calls[2]?.body).toMatchObject({ engine: { name: "tauri-webkitgtk" }, checks: [PASS, FAIL] });
    expect(calls[3]?.body).toBeUndefined();
  });

  it("swallows a collector that cannot be reached, so the page keeps working", async () => {
    const fetchImpl = (async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:8787");
    }) as unknown as typeof fetch;
    const reporter = createReporter(CONFORMANCE_COLLECTOR_BASE_URL, fetchImpl);

    await expect(reporter.progress(PASS)).resolves.toBeUndefined();
    await expect(reporter.result({ engine: { name: "web", version: "v1", userAgent: "UA" }, checks: [] })).resolves.toBeUndefined();
    await expect(reporter.done()).resolves.toBeUndefined();
  });

  it("returns false from heartbeat when the host cannot post it", async () => {
    const fetchImpl = (async () => {
      throw new Error("the renderer is gone");
    }) as unknown as typeof fetch;
    const reporter = createReporter(CONFORMANCE_COLLECTOR_BASE_URL, fetchImpl);
    await expect(reporter.heartbeat()).resolves.toBe(false);
  });

  it("returns true from heartbeat when the POST goes out", async () => {
    const { calls, fetchImpl } = recordingFetch();
    const reporter = createReporter(CONFORMANCE_COLLECTOR_BASE_URL, fetchImpl);
    await expect(reporter.heartbeat()).resolves.toBe(true);
    expect(calls[0]?.url).toBe("http://127.0.0.1:8787/heartbeat");
  });
});
