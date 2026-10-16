// @vitest-environment node
/**
 * The sandbox prelude's QuickJS branch (#516), run against a fake Worker global
 * scope. The prelude is host code, so this drives the real `PRELUDE_SOURCE`
 * string: a QuickJS boot message makes it import the boot-named runner module
 * and hand it the verified sources, the entry, the init event, and the Wasm
 * module as data; an error outcome posts `PLUGIN_ERROR_KIND`; a memory death
 * throws from a fresh task so the Worker error path fires.
 *
 * The runner module is a `data:` URL stub, so `await import(runner)` in the
 * prelude resolves without a real QuickJS engine; the fake scope is the
 * prelude's `self`.
 */

import { afterEach, describe, expect, it } from "vitest";
import { QUICKJS_MEMORY_DEATH_MESSAGE } from "@/features/plugins/quickjs/constants";
import { PRELUDE_SOURCE } from "@/features/plugins/sandbox";
import {
  PLUGIN_BOOT_MESSAGE,
  PLUGIN_ERROR_MESSAGE,
  PLUGIN_INIT_MESSAGE,
} from "@/plugin-sdk/protocol";

/** A data URL module, so the prelude's `await import(runner)` resolves in Node. */
function dataUrl(source: string): string {
  return `data:text/javascript;base64,${Buffer.from(source, "utf8").toString("base64")}`;
}

/** A unique suffix, because Node caches a data: module by its exact URL. */
let nonce = 0;
function unique(source: string): string {
  nonce += 1;
  return `${source}\n//${nonce}`;
}

/** What the runner stub saw, mirroring the options the real runner takes. */
interface RecordedRun {
  sources: Record<string, string>;
  entry: string;
  endpoint: unknown;
  wasmModule: unknown;
  initEvent: { data: unknown; ports: readonly unknown[] };
}

interface BehaviorStore {
  recorded: RecordedRun | null;
  outcome: { kind: "ready" } | { kind: "error"; message: string } | { kind: "memory-death" };
}

/** The runner module the prelude imports: it records its options and answers. */
const RUNNER_STUB = `export const runQuickJsPlugin = (options) => {
  globalThis.__preludeBehavior.recorded = {
    sources: options.sources,
    entry: options.entry,
    endpoint: options.endpoint,
    wasmModule: options.wasmModule,
    initEvent: options.initEvent,
  };
  return { outcome: Promise.resolve(globalThis.__preludeBehavior.outcome), startMs: 0, dispose() {} };
};`;

interface FakeScope {
  onmessage: ((event: { data: unknown; ports: readonly unknown[] }) => void) | null;
  postMessage(data: unknown): void;
  addEventListener(type: string, listener: unknown): void;
  dispatchEvent(event: unknown): void;
}

const SAVED = {
  self: Object.getOwnPropertyDescriptor(globalThis, "self"),
  behavior: (globalThis as Record<string, unknown>).__preludeBehavior,
  microtask: globalThis.queueMicrotask,
};

afterEach(() => {
  if (SAVED.self) Object.defineProperty(globalThis, "self", SAVED.self);
  else delete (globalThis as Record<string, unknown>).self;
  (globalThis as Record<string, unknown>).__preludeBehavior = SAVED.behavior;
  globalThis.queueMicrotask = SAVED.microtask;
});

interface RunInput {
  outcome: BehaviorStore["outcome"];
  sources: Record<string, string>;
  entry: string;
  initData: unknown;
  initPorts?: readonly unknown[];
  captureMicrotasks?: boolean;
}

interface RunOutput {
  posted: unknown[];
  scope: FakeScope;
  recorded: RecordedRun | null;
  microtasks: Array<() => void>;
}

async function runPrelude(input: RunInput): Promise<RunOutput> {
  const posted: unknown[] = [];
  const microtasks: Array<() => void> = [];
  const scope: FakeScope = {
    onmessage: null,
    postMessage: (data) => {
      posted.push(data);
    },
    addEventListener: () => {},
    dispatchEvent: () => {},
  };
  const store: BehaviorStore = { recorded: null, outcome: input.outcome };
  (globalThis as Record<string, unknown>).self = scope;
  (globalThis as Record<string, unknown>).__preludeBehavior = store;
  if (input.captureMicrotasks) {
    globalThis.queueMicrotask = (callback: () => void) => {
      microtasks.push(callback);
    };
  }

  const runnerUrl = dataUrl(unique(RUNNER_STUB));
  await import(/* @vite-ignore */ dataUrl(unique(PRELUDE_SOURCE)));
  if (typeof scope.onmessage !== "function")
    throw new Error("the prelude never installed onmessage");

  scope.onmessage({
    data: {
      kind: PLUGIN_BOOT_MESSAGE.kind,
      entry: input.entry,
      engine: "quickjs",
      runner: runnerUrl,
      sources: input.sources,
      wasmModule: undefined,
    },
    ports: [],
  });
  scope.onmessage({
    data: { kind: PLUGIN_INIT_MESSAGE.kind, startReason: "launch" },
    ports: input.initPorts ?? [],
  });

  // Let boot()'s awaits settle.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { posted, scope, recorded: store.recorded, microtasks };
}

describe("the sandbox prelude on the QuickJS branch", () => {
  it("imports the boot-named runner and hands it the sources, entry, and init as data", async () => {
    const sources = {
      "index.js": "throw new Error('Plugin bytes must never be evaluated');",
      "lib/helper.js": "export const helper = 1;",
    };
    const run = await runPrelude({
      outcome: { kind: "ready" },
      sources,
      entry: "index.js",
      initData: { kind: PLUGIN_INIT_MESSAGE.kind, startReason: "launch" },
    });

    expect(run.recorded).not.toBeNull();
    expect(run.recorded?.entry).toBe("index.js");
    expect(run.recorded?.sources).toEqual(sources);
    // The prelude passed the Worker scope itself as the endpoint.
    expect(run.recorded?.endpoint).toBe(run.scope);
    expect(run.recorded?.wasmModule).toBeUndefined();
    expect(run.recorded?.initEvent.data).toEqual({
      kind: PLUGIN_INIT_MESSAGE.kind,
      startReason: "launch",
    });
    // The Plugin's bytes stayed data: nothing was evaluated and nothing posted.
    expect(run.posted).toEqual([]);
  });

  it("forwards the init event's ports to the runner unchanged", async () => {
    const port = { name: "a-port" };
    const run = await runPrelude({
      outcome: { kind: "ready" },
      sources: { "index.js": "1" },
      entry: "index.js",
      initData: { kind: PLUGIN_INIT_MESSAGE.kind },
      initPorts: [port],
    });
    expect(run.recorded?.initEvent.ports).toEqual([port]);
  });

  it("posts PLUGIN_ERROR_KIND on an error outcome, like the native catch", async () => {
    const run = await runPrelude({
      outcome: { kind: "error", message: "boom" },
      sources: { "index.js": "1" },
      entry: "index.js",
      initData: { kind: PLUGIN_INIT_MESSAGE.kind },
    });
    expect(run.posted).toContainEqual({
      kind: PLUGIN_ERROR_MESSAGE.kind,
      message: "boom",
    });
  });

  it("throws from a fresh task on memory death so the Worker error path fires", async () => {
    const run = await runPrelude({
      outcome: { kind: "memory-death" },
      sources: { "index.js": "1" },
      entry: "index.js",
      initData: { kind: PLUGIN_INIT_MESSAGE.kind },
      captureMicrotasks: true,
    });

    expect(run.posted).toEqual([]);
    expect(run.microtasks.length).toBeGreaterThan(0);
    const thrower = run.microtasks[run.microtasks.length - 1];
    let thrown: unknown;
    try {
      thrower();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    const message = thrown instanceof Error ? thrown.message : "";
    expect(message).toBe(QUICKJS_MEMORY_DEATH_MESSAGE);
    // The lifecycle maps this message to the out-of-memory stop.
    expect(message).toMatch(/out[- ]of[- ]memory/i);
  });
});
