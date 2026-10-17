// @vitest-environment node
/**
 * The QuickJS Plugin runner (#516, ADR 0019): the runner suite. It runs real
 * Plugin bytes (the harness fixture, built from the real SDK) in a memory-capped
 * QuickJS engine with the Android global set, and drives them against the real
 * host broker through `createTestHost()`. Nothing here touches the DOM: the
 * runner is the seam a sandbox Worker, Node, and Vitest all share.
 */

import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  runQuickJsPlugin,
  type QuickJsPluginEndpoint,
  type QuickJsPluginRun,
} from "@/features/plugins/quickjs";
import { createTestHost } from "@/features/plugins/test-kit";
import type { TestHost, TestHostOptions } from "@/features/plugins/types";
import { PLUGIN_INIT_MESSAGE, PLUGIN_READY_MESSAGE } from "@/plugin-sdk/protocol";
import { bundlePluginFixture } from "@/test/support/bundle-plugin-fixture";
import { PLUGIN_MANIFEST } from "@/test/support/plugin-fixtures";

const HARNESS_ENTRY = resolve(process.cwd(), "src/test/fixtures/quickjs/harness.ts");

/** A book the in-memory Library serves, so an allowed call has a real result. */
const BOOK = {
  id: "b1",
  title: "Dune",
  subtitle: null,
  authorName: "Frank",
  language: "en",
  wordCount: 10,
  updatedAt: 0,
};

interface HarnessResult {
  kind: "maibuk:harness-result";
  id: number;
  ok: boolean;
  value?: unknown;
  code?: string | null;
  message?: string;
}

function isHarnessResult(value: unknown): value is HarnessResult {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "maibuk:harness-result"
  );
}

/** The Worker global scope the runner posts to and receives messages from. */
class EndpointDouble implements QuickJsPluginEndpoint {
  readonly messages: unknown[] = [];
  private readonly listeners = new Set<
    (event: { data: unknown; ports: readonly MessagePort[] }) => void
  >();

  postMessage(data: unknown): void {
    this.messages.push(data);
  }

  addEventListener(
    _type: "message",
    listener: (event: { data: unknown; ports: readonly MessagePort[] }) => void
  ): void {
    this.listeners.add(listener);
  }

  /** Deliver one scope `message` event, exactly as the Worker scope would. */
  emit(data: unknown, ports: readonly MessagePort[] = []): void {
    for (const listener of this.listeners) listener({ data, ports });
  }

  readyMessages(): unknown[] {
    return this.messages.filter(
      (message) => (message as { kind?: unknown }).kind === PLUGIN_READY_MESSAGE.kind
    );
  }

  resultFor(id: number): HarnessResult | undefined {
    return this.messages.filter(isHarnessResult).find((message) => message.id === id);
  }
}

interface HarnessSession {
  run: QuickJsPluginRun;
  endpoint: EndpointDouble;
  host: TestHost;
}

/** Start the harness fixture against a real host broker over the runner. */
async function startHarness(hostOptions: TestHostOptions): Promise<HarnessSession> {
  const host = createTestHost(hostOptions);
  const endpoint = new EndpointDouble();
  const source = await bundlePluginFixture(HARNESS_ENTRY);
  const run = runQuickJsPlugin({
    sources: { "index.js": source },
    entry: "index.js",
    endpoint,
    initEvent: {
      data: { kind: PLUGIN_INIT_MESSAGE.kind, startReason: "enable" },
      ports: [host.port],
    },
  });
  return { run, endpoint, host };
}

let nextHarnessId = 1;

/** Ask the harness to call one client method and await the outcome it posts. */
async function harnessCall(
  endpoint: EndpointDouble,
  path: readonly string[],
  params?: unknown
): Promise<HarnessResult> {
  const id = nextHarnessId++;
  endpoint.emit({ kind: "maibuk:harness-call", id, path, params });
  await vi.waitFor(() => {
    expect(endpoint.resultFor(id)).toBeDefined();
  });
  const result = endpoint.resultFor(id);
  if (!result) throw new Error("harness result vanished");
  return result;
}

describe("runQuickJsPlugin()", () => {
  it("evaluates a real Plugin, signals ready, and answers the host's health check", async () => {
    const { run, endpoint, host } = await startHarness({ manifest: PLUGIN_MANIFEST });
    try {
      await expect(run.outcome).resolves.toEqual({ kind: "ready" });
      await vi.waitFor(() => {
        expect(endpoint.readyMessages()).toEqual([PLUGIN_READY_MESSAGE]);
      });
      await expect(host.broker.request("health.check", {})).resolves.toBe("pong");
    } finally {
      run.dispose();
      host.stop();
    }
  });

  it("round-trips an allowed Library call through the real broker", async () => {
    const { run, endpoint, host } = await startHarness({
      manifest: {
        ...PLUGIN_MANIFEST,
        permissions: { required: ["library:read"], optional: [] },
      },
      permissions: ["library:read"],
      library: { books: [BOOK] },
    });
    try {
      await expect(run.outcome).resolves.toEqual({ kind: "ready" });
      const result = await harnessCall(endpoint, ["library", "books", "list"]);
      expect(result).toMatchObject({ ok: true, value: [BOOK] });
    } finally {
      run.dispose();
      host.stop();
    }
  });

  it("rejects a refused call with the SDK's typed permission error", async () => {
    const { run, endpoint, host } = await startHarness({
      manifest: {
        ...PLUGIN_MANIFEST,
        permissions: { required: ["library:read"], optional: [] },
      },
      permissions: [],
      library: { books: [BOOK] },
    });
    try {
      await expect(run.outcome).resolves.toEqual({ kind: "ready" });
      const result = await harnessCall(endpoint, ["library", "books", "list"]);
      expect(result).toMatchObject({ ok: false, code: "permission-denied" });
    } finally {
      run.dispose();
      host.stop();
    }
  });

  it("resolves relative imports across a multi-module graph", async () => {
    const endpoint = new EndpointDouble();
    const run = runQuickJsPlugin({
      sources: {
        "index.js": `import { describe } from "./lib/describe.js"; self.postMessage(describe());`,
        "lib/describe.js": `import { NAME } from "../name.js"; export function describe() { return "hello " + NAME; }`,
        "name.js": `export const NAME = "world";`,
      },
      entry: "index.js",
      endpoint,
    });
    try {
      await expect(run.outcome).resolves.toEqual({ kind: "ready" });
      expect(endpoint.messages).toContain("hello world");
    } finally {
      run.dispose();
    }
  });

  it("passes the WorkerGlobalScope guard so a guarded entry registers its handler", async () => {
    // Conformance Plugins register `self.onmessage` only inside
    // `self instanceof WorkerGlobalScope`, the guard a native Worker satisfies.
    // Without the QuickJS scope answering it, the Plugin never reports ready
    // (#516, the Android conformance startup-timeout).
    const endpoint = new EndpointDouble();
    const run = runQuickJsPlugin({
      sources: {
        "index.js": `if (typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope) {
          self.onmessage = (event) => self.postMessage("got " + event.data.kind);
          self.postMessage("guarded");
        } else {
          self.postMessage("unguarded");
        }`,
      },
      entry: "index.js",
      endpoint,
      initEvent: { data: { kind: "maibuk:plugin-init" }, ports: [] },
    });
    try {
      await expect(run.outcome).resolves.toEqual({ kind: "ready" });
      expect(endpoint.messages).toEqual(["guarded", "got maibuk:plugin-init"]);
    } finally {
      run.dispose();
    }
  });

  it("refuses dynamic code generation the way the native CSP does", async () => {
    // The native frame has no 'unsafe-eval', so eval and every string-compiling
    // constructor throw. The VM must refuse the same paths (#516, conformance
    // checks escapeEval and escapeDynamicImport). Function stays usable as a
    // type for instanceof.
    const endpoint = new EndpointDouble();
    const run = runQuickJsPlugin({
      sources: {
        "index.js": `const attempts = {
            eval: () => eval("1 + 1"),
            Function: () => new Function("return import('https://example.test/x.js')"),
            GeneratorFunction: () => (function* () {}).constructor("yield 1"),
            AsyncFunction: () => (async function () {}).constructor("return 1"),
            AsyncGeneratorFunction: () => (async function* () {}).constructor("yield 1"),
          };
          for (const [name, attempt] of Object.entries(attempts)) {
            try { attempt(); self.postMessage(name + ": escaped"); }
            catch (error) { self.postMessage(name + ": " + error.name); }
          }
          self.postMessage("instanceof: " + ((() => 1) instanceof Function));`,
      },
      entry: "index.js",
      endpoint,
    });
    try {
      await expect(run.outcome).resolves.toEqual({ kind: "ready" });
      expect(endpoint.messages).toEqual([
        "eval: EvalError",
        "Function: EvalError",
        "GeneratorFunction: EvalError",
        "AsyncFunction: EvalError",
        "AsyncGeneratorFunction: EvalError",
        "instanceof: true",
      ]);
    } finally {
      run.dispose();
    }
  });

  it("fails setup with an error for an unknown module in the graph", async () => {
    const endpoint = new EndpointDouble();
    const run = runQuickJsPlugin({
      sources: { "index.js": `import { x } from "./missing.js"; self.postMessage(x);` },
      entry: "index.js",
      endpoint,
    });
    try {
      const outcome = await run.outcome;
      expect(outcome.kind).toBe("error");
      if (outcome.kind !== "error") throw new Error("not an error outcome");
      expect(outcome.message).toMatch(/missing\.js/);
    } finally {
      run.dispose();
    }
  });

  it("exposes the Android global set and hides Intl and WebAssembly", async () => {
    const endpoint = new EndpointDouble();
    const names = [
      "self",
      "postMessage",
      "onmessage",
      "addEventListener",
      "removeEventListener",
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "queueMicrotask",
      "URL",
      "TextEncoder",
      "TextDecoder",
      "console",
      "performance",
    ];
    const run = runQuickJsPlugin({
      sources: {
        "index.js": `(() => {
          const present = {};
          const types = {};
          for (const name of ${JSON.stringify(names)}) {
            present[name] = name in globalThis;
            types[name] = typeof globalThis[name];
          }
          self.postMessage({
            present,
            types,
            performanceNow: typeof globalThis.performance.now,
            intl: typeof globalThis.Intl,
            webAssembly: typeof globalThis.WebAssembly,
          });
        })();`,
      },
      entry: "index.js",
      endpoint,
    });
    try {
      await expect(run.outcome).resolves.toEqual({ kind: "ready" });
      const report = endpoint.messages[0] as {
        present: Record<string, boolean>;
        types: Record<string, string>;
        performanceNow: string;
        intl: string;
        webAssembly: string;
      };
      for (const name of names) expect(report.present[name], name).toBe(true);
      expect(report.performanceNow).toBe("function");
      expect(report.intl).toBe("undefined");
      expect(report.webAssembly).toBe("undefined");
    } finally {
      run.dispose();
    }
  });

  it("orders microtasks before timers, like a Worker", async () => {
    const endpoint = new EndpointDouble();
    const run = runQuickJsPlugin({
      sources: {
        "index.js": `self.postMessage("sync-1");
          setTimeout(() => self.postMessage("timeout"), 0);
          Promise.resolve().then(() => self.postMessage("microtask"));
          queueMicrotask(() => self.postMessage("microtask-2"));
          self.postMessage("sync-2");`,
      },
      entry: "index.js",
      endpoint,
    });
    try {
      await expect(run.outcome).resolves.toEqual({ kind: "ready" });
      await vi.waitFor(() => {
        expect(endpoint.messages).toContain("timeout");
      });
      expect(endpoint.messages).toEqual([
        "sync-1",
        "sync-2",
        "microtask",
        "microtask-2",
        "timeout",
      ]);
    } finally {
      run.dispose();
    }
  });

  it("runs queueMicrotask callbacks in FIFO order before a setTimeout(0)", async () => {
    const endpoint = new EndpointDouble();
    const run = runQuickJsPlugin({
      sources: {
        "index.js": `queueMicrotask(() => self.postMessage("micro-1"));
          queueMicrotask(() => self.postMessage("micro-2"));
          queueMicrotask(() => self.postMessage("micro-3"));
          setTimeout(() => self.postMessage("timeout"), 0);`,
      },
      entry: "index.js",
      endpoint,
    });
    try {
      await expect(run.outcome).resolves.toEqual({ kind: "ready" });
      await vi.waitFor(() => {
        expect(endpoint.messages).toContain("timeout");
      });
      expect(endpoint.messages).toEqual(["micro-1", "micro-2", "micro-3", "timeout"]);
    } finally {
      run.dispose();
    }
  });

  it("repeats a setInterval until clearInterval stops it", async () => {
    const endpoint = new EndpointDouble();
    const run = runQuickJsPlugin({
      sources: {
        "index.js": `let count = 0;
          const id = setInterval(() => {
            count += 1;
            self.postMessage("interval:" + count);
            if (count >= 3) clearInterval(id);
          }, 1);
          setTimeout(() => self.postMessage("settled"), 30);`,
      },
      entry: "index.js",
      endpoint,
    });
    try {
      await expect(run.outcome).resolves.toEqual({ kind: "ready" });
      await vi.waitFor(() => {
        expect(endpoint.messages).toContain("settled");
      });
      // No interval:4: clearInterval stopped the repeat the tick it was called.
      expect(endpoint.messages).toEqual(["interval:1", "interval:2", "interval:3", "settled"]);
    } finally {
      run.dispose();
    }
  });

  it("cancels a pending timeout with clearTimeout", async () => {
    const endpoint = new EndpointDouble();
    const run = runQuickJsPlugin({
      sources: {
        "index.js": `const cancelled = setTimeout(() => self.postMessage("cancelled"), 10);
          clearTimeout(cancelled);
          setTimeout(() => self.postMessage("kept"), 30);`,
      },
      entry: "index.js",
      endpoint,
    });
    try {
      await expect(run.outcome).resolves.toEqual({ kind: "ready" });
      await vi.waitFor(() => {
        expect(endpoint.messages).toContain("kept");
      });
      expect(endpoint.messages).toEqual(["kept"]);
    } finally {
      run.dispose();
    }
  });

  it("provides the pure-JS VM shims the Remote DOM SDK loads before a Plugin graph", async () => {
    const endpoint = new EndpointDouble();
    // The Android host global set is exactly the plan's list; these are VM-side
    // shims, not host globals. QuickJS has no DOM, so Remote DOM's elements
    // (`RemoteElement extends HTMLElement`, `RemoteEvent extends CustomEvent`,
    // `RemoteMutationObserver extends MutationObserver`) and `@quilted/threads`
    // (`AbortController`, `crypto.getRandomValues`) fail to evaluate without
    // them. The UI path's polyfill replaces the DOM ones; crypto and
    // AbortController stay ours.
    const shims = [
      "EventTarget",
      "Event",
      "CustomEvent",
      "HTMLElement",
      "MutationObserver",
      "AbortSignal",
      "AbortController",
      "crypto",
    ];
    const run = runQuickJsPlugin({
      sources: {
        "index.js": `(() => {
          const types = {};
          for (const name of ${JSON.stringify(shims)}) types[name] = typeof globalThis[name];
          const bytes = globalThis.crypto.getRandomValues(new Uint8Array(4));
          self.postMessage({ types, randomLength: bytes.length });
        })();`,
      },
      entry: "index.js",
      endpoint,
    });
    try {
      await expect(run.outcome).resolves.toEqual({ kind: "ready" });
      const report = endpoint.messages[0] as {
        types: Record<string, string>;
        randomLength: number;
      };
      for (const name of [
        "EventTarget",
        "Event",
        "CustomEvent",
        "HTMLElement",
        "MutationObserver",
        "AbortSignal",
        "AbortController",
      ]) {
        expect(report.types[name], name).toBe("function");
      }
      expect(report.types.crypto).toBe("object");
      expect(report.randomLength).toBe(4);
    } finally {
      run.dispose();
    }
  });

  /** Run one OOM source under a 2 MB cap and assert a clean memory death. */
  async function expectMemoryDeath(source: string): Promise<void> {
    const endpoint = new EndpointDouble();
    const onMemoryDeath = vi.fn();
    const run = runQuickJsPlugin({
      sources: { "index.js": source },
      entry: "index.js",
      endpoint,
      memoryCapBytes: 2 * 1024 * 1024,
      onMemoryDeath,
    });
    try {
      await expect(run.outcome).resolves.toEqual({ kind: "memory-death" });
      expect(onMemoryDeath).toHaveBeenCalledTimes(1);
      expect(endpoint.messages).toEqual([]);
    } finally {
      run.dispose();
    }
  }

  it("ends as memory-death, once, when array growth exhausts the heap cap", async () => {
    await expectMemoryDeath(`const held = [];
      for (let i = 0; i < 20000000; i++) held.push(i);
      self.postMessage(held.length);`);
  });

  it("ends as memory-death when string growth exhausts the heap cap", async () => {
    await expectMemoryDeath(`let text = "";
      for (let i = 0; i < 20000000; i++) text += "abcdefghij";
      self.postMessage(text.length);`);
  });

  it("ends as memory-death, once, when an async allocation loop exhausts the cap", async () => {
    // The out-of-memory is raised inside an async function, so QuickJS turns it
    // into a rejected promise nothing reports. The per-turn heap check is what
    // ends the run (#516, decision 1a).
    await expectMemoryDeath(`async function grow() {
        const held = [];
        for (;;) { held.push(new Array(10000).fill(1)); await 0; }
      }
      // The rejection is never awaited, as in the conformance T8 Plugin, so
      // only the per-turn heap check can end the run.
      grow().catch(() => {});`);
  });

  it("never kills a Plugin that allocates well under the cap", async () => {
    const endpoint = new EndpointDouble();
    const onMemoryDeath = vi.fn();
    const run = runQuickJsPlugin({
      sources: {
        "index.js": `async function grow() {
            const held = [];
            for (let i = 0; i < 10; i++) { held.push(new Array(10000).fill(1)); await 0; }
            self.postMessage(held.length);
          }
          await grow();`,
      },
      entry: "index.js",
      endpoint,
      memoryCapBytes: 2 * 1024 * 1024,
      onMemoryDeath,
    });
    try {
      await expect(run.outcome).resolves.toEqual({ kind: "ready" });
      expect(endpoint.messages).toEqual([10]);
      expect(onMemoryDeath).not.toHaveBeenCalled();
    } finally {
      run.dispose();
    }
  });

  it("reports a top-level throw as an error, never as memory death", async () => {
    const endpoint = new EndpointDouble();
    const onMemoryDeath = vi.fn();
    const run = runQuickJsPlugin({
      sources: { "index.js": `throw new Error("setup exploded");` },
      entry: "index.js",
      endpoint,
      onMemoryDeath,
    });
    try {
      await expect(run.outcome).resolves.toEqual({
        kind: "error",
        message: "setup exploded",
      });
      expect(onMemoryDeath).not.toHaveBeenCalled();
    } finally {
      run.dispose();
    }
  });
});
