/**
 * Test support for Plugin suites: manifest and folder builders, a folder
 * reader shared with the E2E seed, and a fake sandbox frame that plays the
 * plugin's side of the MessagePort (jsdom has no Worker). The real sandbox
 * frame is proven in the browser by the E2E tracer and the source gate; these
 * helpers prove the host's startup and launch logic without a browser.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type {
  PluginFolder,
  PluginFolderFile,
  PluginManifest,
  PluginSandboxFrame,
} from "@/features/plugins/types";
import { PLUGIN_READY_MESSAGE } from "@/plugin-sdk/protocol";

const encoder = new TextEncoder();

/** A valid manifest; `pluginFolder()` merges overrides into it. */
export const PLUGIN_MANIFEST: PluginManifest = {
  manifestVersion: 1,
  id: "tracer",
  name: "Tracer",
  description: "The tracer fixture",
  author: "Maibuk",
  version: "1.0.0",
  apiVersion: "^0.1",
  entry: "index.js",
  platforms: ["web"],
  lifecycle: "persistent",
  defaultLanguage: "en",
  permissions: { required: [], optional: [] },
};

/** Every file under `dir`, keyed by its POSIX-relative path. */
export function readFolderFiles(dir: string): PluginFolderFile[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const path = relative(dir, join(entry.parentPath, entry.name)).replace(/\\/g, "/");
      return { path, bytes: readFileSync(join(dir, path)) };
    });
}

/** A folder built from source strings, with no manifest. */
export function sourceFolder(entries: Record<string, string>): PluginFolder {
  const files: PluginFolderFile[] = Object.entries(entries).map(([path, source]) => ({
    path,
    bytes: encoder.encode(source),
  }));
  return { name: PLUGIN_MANIFEST.id, files };
}

export function pluginFolder(
  entries: Record<string, string>,
  overrides: Partial<PluginManifest> = {}
): PluginFolder {
  const manifest = { ...PLUGIN_MANIFEST, ...overrides };
  const files = sourceFolder({
    "manifest.json": JSON.stringify(manifest),
    "index.js": "export const a = 1;",
    ...entries,
  }).files;
  return { name: manifest.id, files };
}

/**
 * Replaces `MessageChannel` with an in-process pair that delivers through
 * microtasks. jsdom delivers a real port on a task the fake timers do not
 * control, so a long `advanceTimersByTime` would starve every broker reply and
 * the heartbeat would report phantom misses. The sandbox itself is proven in a
 * browser by the E2E lane; this keeps the state machine's timing tests exact.
 */
export function installMicrotaskMessageChannel(): () => void {
  const original = globalThis.MessageChannel;

  class FakeMessagePort {
    onmessage: ((event: MessageEvent) => void) | null = null;
    peer: FakeMessagePort | null = null;
    postMessage(data: unknown): void {
      const peer = this.peer;
      if (!peer) return;
      queueMicrotask(() => {
        peer.onmessage?.({ data } as MessageEvent);
      });
    }
    close(): void {
      this.peer = null;
    }
  }

  class FakeMessageChannel {
    port1 = new FakeMessagePort();
    port2 = new FakeMessagePort();
    constructor() {
      this.port1.peer = this.port2;
      this.port2.peer = this.port1;
    }
  }

  globalThis.MessageChannel = FakeMessageChannel as unknown as typeof MessageChannel;
  return () => {
    globalThis.MessageChannel = original;
  };
}

export interface FakePluginFrame extends PluginSandboxFrame {
  sources: Map<string, string>;
  entryUrl: string | null;
  pluginPort: MessagePort | null;
  /** Host-to-plugin requests the fake saw, in order. */
  requests: string[];
  healthAnswer: "pong" | "refuse";
  /**
   * Answers one host request (health checks, `migrateData`). Defaults to the
   * `healthAnswer` reply.
   */
  hostRequestAnswer: (method: string, params: unknown) => Promise<unknown>;
  /** While true, host requests are held: the hung Worker heartbeat tests need that. */
  holdAnswers: boolean;
  /** Answers every held host request with a pong. */
  answerHeldRequests(): void;
  /** Plays the plugin side: sends a call to the host broker and settles on its result. */
  call(method: string, params?: unknown): Promise<unknown>;
  signalReady(): void;
  signalError(message: string): void;
  readonly stopped: boolean;
}

export function fakePluginFrame(options: { ready?: boolean; fail?: string } = {}): FakePluginFrame {
  let workerMessage: ((data: unknown) => void) | null = null;
  let workerError: ((message: string) => void) | null = null;
  let stopped = false;
  let nextCallId = 1;
  const pendingCalls = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: unknown) => void }
  >();
  const heldAnswers = new Map<number, MessagePort>();
  const frame: FakePluginFrame = {
    element: {} as HTMLIFrameElement,
    ready: Promise.resolve(),
    sources: new Map(),
    entryUrl: null,
    pluginPort: null,
    requests: [],
    healthAnswer: "pong",
    holdAnswers: false,
    hostRequestAnswer: async () => {
      if (frame.healthAnswer === "pong") return "pong";
      throw { code: "internal-error", message: "no handler" };
    },
    answerHeldRequests() {
      for (const [id, port] of heldAnswers) {
        port.postMessage(JSON.stringify({ kind: "reply", id, ok: true, result: "pong" }));
      }
      heldAnswers.clear();
    },
    get stopped() {
      return stopped;
    },
    async createModule(source: string) {
      const url = `blob:fake/${frame.sources.size}`;
      frame.sources.set(url, source);
      return url;
    },
    async startWorker(url: string, port: MessagePort) {
      frame.entryUrl = url;
      frame.pluginPort = port;
      port.onmessage = (event) => {
        const message = event.data as {
          kind: string;
          id: number;
          method?: string;
          params?: unknown;
          ok?: boolean;
          result?: unknown;
          error?: unknown;
        };
        if (message.kind === "request") {
          frame.requests.push(message.method ?? "");
          if (frame.holdAnswers) {
            heldAnswers.set(message.id, port);
            return;
          }
          void frame.hostRequestAnswer(message.method ?? "", message.params).then(
            (result) => {
              port.postMessage(JSON.stringify({ kind: "reply", id: message.id, ok: true, result }));
            },
            (error: unknown) => {
              const data =
                typeof error === "object" && error !== null && "code" in error
                  ? error
                  : {
                      code: "internal-error",
                      message: error instanceof Error ? error.message : String(error),
                    };
              port.postMessage(
                JSON.stringify({ kind: "reply", id: message.id, ok: false, error: data })
              );
            }
          );
          return;
        }
        if (message.kind === "result") {
          const pending = pendingCalls.get(message.id);
          pendingCalls.delete(message.id);
          if (message.ok) pending?.resolve(message.result);
          else pending?.reject(message.error);
        }
      };
      queueMicrotask(() => {
        if (options.fail) workerError?.(options.fail);
        else if (options.ready !== false) workerMessage?.(PLUGIN_READY_MESSAGE);
      });
    },
    call(method: string, params?: unknown) {
      const id = nextCallId++;
      return new Promise((resolve, reject) => {
        pendingCalls.set(id, { resolve, reject });
        frame.pluginPort?.postMessage(
          JSON.stringify({ kind: "call", id, method, params: params ?? {} })
        );
      });
    },
    onWorkerMessage(handler) {
      workerMessage = handler;
    },
    onWorkerError(handler) {
      workerError = handler;
    },
    stop() {
      stopped = true;
    },
    signalReady() {
      workerMessage?.(PLUGIN_READY_MESSAGE);
    },
    signalError(message) {
      workerError?.(message);
    },
  };
  return frame;
}
