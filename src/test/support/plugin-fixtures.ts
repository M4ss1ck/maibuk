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
  return sourceFolder({
    "manifest.json": JSON.stringify({ ...PLUGIN_MANIFEST, ...overrides }),
    "index.js": "export const a = 1;",
    ...entries,
  });
}

export interface FakePluginFrame extends PluginSandboxFrame {
  sources: Map<string, string>;
  entryUrl: string | null;
  pluginPort: MessagePort | null;
  /** Host-to-plugin requests the fake saw, in order. */
  requests: string[];
  healthAnswer: "pong" | "refuse";
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
  const frame: FakePluginFrame = {
    element: {} as HTMLIFrameElement,
    ready: Promise.resolve(),
    sources: new Map(),
    entryUrl: null,
    pluginPort: null,
    requests: [],
    healthAnswer: "pong",
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
          ok?: boolean;
          result?: unknown;
          error?: unknown;
        };
        if (message.kind === "request") {
          frame.requests.push(message.method ?? "");
          port.postMessage(
            JSON.stringify(
              frame.healthAnswer === "pong"
                ? { kind: "reply", id: message.id, ok: true, result: "pong" }
                : {
                    kind: "reply",
                    id: message.id,
                    ok: false,
                    error: { code: "internal-error", message: "no handler" },
                  }
            )
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
