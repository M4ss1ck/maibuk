// The fixture-hostile Plugin (issue #446): one Command per escape attempt, so
// the @sandbox E2E lane can prove the sandbox CSP, the broker, and the Remote UI
// validator refuse every escape safely on the real engines. It is built from
// this source into e2e/.output/plugins/fixture-hostile by the E2E global setup;
// the bundle is never committed and never shipped.
//
// Every escape reports through one notification ("hostile <id> refused: <code>"
// or "hostile <id> ignored"); a spec runs the Command from the Command Palette
// and asserts that text, plus zero leaked requests on the Node side. The
// terminal ones (a busy loop, an allocation until killed) cannot report: the
// host stops the Plugin with a reason instead.
//
// The Worker entry installs the Remote DOM polyfill, so it stays first among
// the SDK imports, exactly as the other fixture Plugins do.

import { servePluginUi } from "@/plugin-sdk/worker-ui";
import { type ComponentType } from "react";
import {
  PLUGIN_COMMAND_RUN_REQUEST,
  createPluginClient,
  ui,
  type PluginClient,
} from "@/plugin-sdk";

// The recorder origin the E2E build injects (Vite `define`
// `__REQUEST_LOG_ORIGIN__`, `e2e/support/plugin-fixtures-build.ts`); the global
// setup starts the recorder on a free port, so every escape targets this run's
// server and the lane's pass rule is that its request log stays empty. Declared
// so the fixture type-checks; the constant is replaced at build time.
declare const __REQUEST_LOG_ORIGIN__: string;

const LEAK_ORIGIN = __REQUEST_LOG_ORIGIN__;
const LEAK_URL = `${LEAK_ORIGIN}/escape`;
const LEAK_SOCKET_URL = `${LEAK_ORIGIN.replace(/^http/, "ws")}/socket`;

/** How long an event-based escape waits before it calls the block a silent refusal. */
const BLOCKED_AFTER_MS = 3_000;

const BLOCKED = Symbol("blocked");

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The most useful label for a refusal: a broker code first, then an error name. */
function errorLabel(error: unknown): string {
  if (error !== null && typeof error === "object") {
    const record = error as { code?: unknown; name?: unknown };
    if (typeof record.code === "string" && record.code !== "") return record.code;
    if (typeof record.name === "string" && record.name !== "") return record.name;
  }
  if (typeof error === "string" && error !== "") return error;
  return "unknown";
}

/** An error whose name is the refusal label an engine could not give us itself. */
function refusalError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

async function within<T>(work: Promise<T>): Promise<T | typeof BLOCKED> {
  return Promise.race([
    work,
    new Promise<typeof BLOCKED>((resolve) => setTimeout(() => resolve(BLOCKED), BLOCKED_AFTER_MS)),
  ]);
}

/** Settles an escape that may succeed, throw, or be silently blocked by the CSP. */
async function settle(work: Promise<unknown>): Promise<string> {
  try {
    const outcome = await within(work);
    return outcome === BLOCKED ? "refused: blocked" : "escaped";
  } catch (error) {
    return `refused: ${errorLabel(error)}`;
  }
}

/** Settles a synchronous escape attempt. */
function settleSync(run: () => unknown): string {
  try {
    run();
    return "escaped";
  } catch (error) {
    return `refused: ${errorLabel(error)}`;
  }
}

interface RawResult {
  ok?: boolean;
  error?: { code?: string };
}

interface HostileRuntime {
  client: PluginClient;
  port: MessagePort;
  /** Sends a raw wire message and resolves with the broker's reply. */
  rawCall(id: number, method: string, params: unknown): Promise<RawResult>;
  /** Shows a report, retrying past the host's one-per-5-s notification limit. */
  report(message: string): Promise<void>;
}

const ESCAPES: Record<string, (runtime: HostileRuntime) => Promise<string> | string> = {
  escapeFetch: () => settle(fetch(LEAK_URL, { mode: "no-cors" })),

  escapeXhr: () =>
    settle(
      new Promise<void>((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.onload = () => resolve();
        request.onerror = () => reject(refusalError("NetworkError", "XMLHttpRequest refused"));
        request.open("GET", LEAK_URL);
        request.send();
      })
    ),

  escapeWebSocket: () =>
    settle(
      new Promise<void>((resolve, reject) => {
        const socket = new WebSocket(LEAK_SOCKET_URL);
        socket.onopen = () => {
          socket.close();
          resolve();
        };
        socket.onerror = () => reject(refusalError("SecurityError", "WebSocket refused"));
      })
    ),

  escapeEventSource: () =>
    settle(
      new Promise<void>((resolve, reject) => {
        const source = new EventSource(LEAK_URL);
        source.onopen = () => {
          source.close();
          resolve();
        };
        source.onerror = () => reject(refusalError("NetworkError", "EventSource refused"));
      })
    ),

  escapeSendBeacon: () =>
    settleSync(() =>
      (navigator as unknown as { sendBeacon: (url: string, data: string) => boolean }).sendBeacon(
        LEAK_URL,
        "hostile"
      )
    ),

  escapeImportScripts: () => settleSync(() => importScripts(LEAK_URL)),

  // A literal remote `import()` is refused before the Worker starts: the module
  // planner only allows relative specifiers inside the Plugin folder. This is the
  // runtime half — dynamic code generation, which the CSP also refuses.
  escapeDynamicImport: () =>
    settleSync(() => new Function(`return import(${JSON.stringify(LEAK_URL)})`)),

  escapeEval: () =>
    // biome-ignore lint/security/noGlobalEval: the escape attempt is this fixture's purpose
    settleSync(() => eval("1 + 1")),

  escapeDataWorker: () =>
    settle(
      new Promise<void>((resolve, reject) => {
        const worker = new Worker("data:text/javascript,self.postMessage(1)");
        worker.onmessage = () => {
          worker.terminate();
          resolve();
        };
        worker.onerror = () => {
          worker.terminate();
          reject(refusalError("SecurityError", "data: Worker refused"));
        };
      })
    ),

  escapeIndexedDb: () =>
    settle(
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("hostile");
        request.onsuccess = () => {
          request.result.close();
          resolve();
        };
        request.onerror = () => reject(refusalError("SecurityError", "IndexedDB refused"));
      })
    ),

  escapeCaches: async () => {
    // The opaque origin gives the Plugin its own partitioned Cache Storage: it
    // can open a cache, but it sees nothing of Maibuk's.
    const cache = await caches.open("maibuk");
    const keys = await cache.keys();
    return keys.length === 0 ? "refused: isolated" : "escaped";
  },

  escapeLocalStorage: () => settleSync(() => localStorage.getItem("hostile")),

  escapeTauriIpc: () =>
    settleSync(() =>
      (
        self as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string) => unknown } }
      ).__TAURI_INTERNALS__.invoke("plugin:hostile|escape")
    ),

  escapeOversized: async (runtime) => {
    const payload = "x".repeat(4 * 1024 * 1024 + 64);
    const reply = await runtime.rawCall(900001, "storage.keys", { payload });
    return reply.ok === false ? `refused: ${reply.error?.code ?? "error"}` : "escaped";
  },

  escapeUnknownMethod: async (runtime) => {
    const reply = await runtime.rawCall(900002, "library.books.burn", {});
    return reply.ok === false ? `refused: ${reply.error?.code ?? "error"}` : "escaped";
  },

  escapeSpoofedReply: async (runtime) => {
    // A reply for an id the host never asked about: the broker must ignore it.
    runtime.port.postMessage(
      JSON.stringify({ kind: "reply", id: 900003, ok: true, result: { spoofed: true } })
    );
    await sleep(50);
    // A real call still settles with its own result, not the forged one.
    const keys = await runtime.client.storage.keys();
    return Array.isArray(keys) ? "ignored" : "escaped";
  },

  escapeWrite: async (runtime) => {
    try {
      await runtime.client.library.notes.update({ noteId: "hostile-note" });
      return "escaped";
    } catch (error) {
      return `refused: ${errorLabel(error)}`;
    }
  },

  escapeAfterRevoke: async (runtime) => {
    try {
      await runtime.client.library.books.list();
      return "escaped";
    } catch (error) {
      return `refused: ${errorLabel(error)}`;
    }
  },

  escapeBusyLoop: () =>
    new Promise<string>(() => {
      // Blocks the Worker's message loop: the host's heartbeat misses and stops
      // the Plugin with `unresponsive`. The `performance.now()` call keeps the
      // loop from being optimized away.
      for (;;) {
        if (performance.now() < 0) break;
      }
    }),

  escapeAllocate: () =>
    new Promise<string>(() => {
      const chunks: Uint8Array[] = [];
      // The `performance.now()` call keeps the loop from being optimized away,
      // and `fill` commits each chunk so it counts against the Worker's heap.
      for (;;) {
        const chunk = new Uint8Array(32 * 1024 * 1024);
        chunk.fill(1);
        chunks.push(chunk);
        if (performance.now() < 0) break;
      }
    }),

  escapeFlood: async (runtime) => {
    const calls: Promise<RawResult>[] = [];
    for (let i = 0; i < 700; i++) calls.push(runtime.rawCall(910000 + i, "storage.keys", {}));
    const replies = await Promise.all(calls);
    const throttled = replies.some(
      (reply) => reply.ok === false && reply.error?.code === "rate-limited"
    );
    return throttled ? "refused: rate-limited" : "escaped";
  },
};

/** The readiness page: a valid tree a spec waits for before it runs Commands. */
function Panel() {
  return (
    <ui.View direction="column" gap="md">
      <ui.Heading>Hostile fixture</ui.Heading>
      <ui.Text>Sandbox escape fixture.</ui.Text>
    </ui.View>
  );
}

/** A prop outside its schema: the host validator refuses it and stops the Plugin. */
function Violation() {
  return (
    <ui.View direction="column" gap="md">
      <ui.Heading>Hostile UI violation</ui.Heading>
      <ui.Status tone={"bogus" as never}>This tone is outside the schema.</ui.Status>
    </ui.View>
  );
}

/**
 * One mount far past the Remote UI budget: `PLUGIN_UI_LIMITS.maxNodes` is
 * 10,000, and this tree is twice that, so the validator refuses it however React
 * splits its commits and the host stops the Plugin with `remote-ui-limit`.
 */
const FLOOD_NODES = 12_000;

function Flood() {
  return (
    <ui.View direction="column" gap="sm">
      <ui.Heading>Hostile UI flood</ui.Heading>
      {Array.from({ length: FLOOD_NODES }, (_, index) => (
        <ui.Text key={index}>{`Node ${index}`}</ui.Text>
      ))}
    </ui.View>
  );
}

function createRuntime(port: MessagePort): HostileRuntime {
  const client = createPluginClient(port);
  const rawPending = new Map<number, (reply: RawResult) => void>();
  // The SDK owns `port.onmessage`; keep its handler and hand every message that
  // is not one of this fixture's raw replies back to it.
  const sdkOnMessage = port.onmessage;
  port.onmessage = (event: MessageEvent) => {
    const data: unknown = event.data;
    if (data !== null && typeof data === "object") {
      const message = data as { kind?: unknown; id?: unknown };
      if (
        message.kind === "result" &&
        typeof message.id === "number" &&
        rawPending.has(message.id)
      ) {
        const settleRaw = rawPending.get(message.id);
        rawPending.delete(message.id);
        settleRaw?.(data as RawResult);
        return;
      }
    }
    sdkOnMessage?.call(port, event);
  };

  function rawCall(id: number, method: string, params: unknown): Promise<RawResult> {
    return new Promise<RawResult>((resolve) => {
      rawPending.set(id, resolve);
      port.postMessage(JSON.stringify({ kind: "call", id, method, params }));
    });
  }

  let queue: Promise<void> = Promise.resolve();
  async function show(message: string): Promise<void> {
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        await client.notifications.show({ variant: "error", message });
        return;
      } catch (error) {
        if ((error as { code?: string }).code === "rate-limited") {
          await sleep(250);
          continue;
        }
        return;
      }
    }
  }

  function report(message: string): Promise<void> {
    queue = queue.then(() => show(message)).catch(() => {});
    return queue;
  }

  return { client, port, rawCall, report };
}

async function runCommand(runtime: HostileRuntime, params: unknown): Promise<null> {
  const { id } = (params ?? {}) as { id?: string };
  const attempt = id === undefined ? undefined : ESCAPES[id];
  if (attempt === undefined) return null;
  let detail: string;
  try {
    detail = await attempt(runtime);
  } catch (error) {
    detail = `refused: ${errorLabel(error)}`;
  }
  await runtime.report(`hostile ${id} ${detail}`);
  return null;
}

if (
  typeof self !== "undefined" &&
  typeof WorkerGlobalScope !== "undefined" &&
  self instanceof WorkerGlobalScope
) {
  self.onmessage = (event) => {
    const port = event.ports && event.ports[0];
    if (!port) return;
    const runtime = createRuntime(port);
    servePluginUi(runtime.client, {
      pages: { panel: Panel, violation: Violation as ComponentType, flood: Flood as ComponentType },
      onHostRequest: (method, params) => {
        if (method === "health.check") return "pong";
        if (method === PLUGIN_COMMAND_RUN_REQUEST) return runCommand(runtime, params);
        throw new Error(`No handler for ${method}`);
      },
    });
    self.postMessage({ kind: "maibuk:plugin-ready" });
  };
}
