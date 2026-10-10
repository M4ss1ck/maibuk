/**
 * The Maibuk Plugin SDK client: the whole Plugin API as namespaced,
 * promise-based methods over the one MessagePort the host gives the Plugin.
 * `maibuk.library.books.list()` sends a call to the host broker and resolves
 * with its result or rejects with a `PluginApiError`.
 *
 * This entry point bundles into Plugins, so it imports only `src/plugin-sdk/`.
 */

import { PLUGIN_API_METHODS, type PluginApi } from "@/plugin-sdk/api.generated";
import {
  type HostToPluginMessage,
  PLUGIN_MESSAGE_MAX_BYTES,
  PluginApiError,
  type PluginApiErrorData,
  utf8ByteLength,
} from "@/plugin-sdk/protocol";

export * from "@/plugin-sdk/api.generated";
export * from "@/plugin-sdk/protocol";

export type HostRequestHandler = (method: string, params: unknown) => unknown;

export type PluginClient = PluginApi & {
  /** True once the host stopped this Plugin; every call then rejects `plugin-stopped`. */
  readonly stopped: boolean;
  /** Answers the host's requests to this Plugin (health checks, Command runs). */
  onHostRequest(handler: HostRequestHandler): void;
};

/** The subset of `MessagePort` the client uses. */
export interface PluginClientPort {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent) => void) | null;
}

function stoppedError(reason: string): PluginApiError {
  return new PluginApiError({ code: "plugin-stopped", message: `Plugin stopped: ${reason}` });
}

export function createPluginClient(port: PluginClientPort): PluginClient {
  let nextId = 1;
  let stopReason: string | null = null;
  let hostRequestHandler: HostRequestHandler | null = null;
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: unknown) => void }
  >();

  function call(method: string, params: unknown): Promise<unknown> {
    if (stopReason !== null) return Promise.reject(stoppedError(stopReason));
    const id = nextId++;
    // `kind` and `id` lead so the broker can answer a refused call without decoding it.
    const text = JSON.stringify({ kind: "call", id, method, params: params ?? {} });
    if (utf8ByteLength(text) > PLUGIN_MESSAGE_MAX_BYTES) {
      return Promise.reject(
        new PluginApiError({
          code: "message-too-large",
          message: "Messages to Maibuk are capped at 4 MB",
          method,
        })
      );
    }
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      port.postMessage(text);
    });
  }

  async function answer(id: number, method: string, params: unknown) {
    try {
      if (!hostRequestHandler) throw new Error(`No handler for ${method}`);
      const result = await hostRequestHandler(method, params);
      port.postMessage(JSON.stringify({ kind: "reply", id, ok: true, result: result ?? null }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const data: PluginApiErrorData = { code: "internal-error", message, method };
      port.postMessage(JSON.stringify({ kind: "reply", id, ok: false, error: data }));
    }
  }

  port.onmessage = (event: MessageEvent) => {
    const message = event.data as HostToPluginMessage;
    if (typeof message !== "object" || message === null) return;
    if (message.kind === "result") {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.ok) entry.resolve(message.result);
      else entry.reject(new PluginApiError(message.error));
    } else if (message.kind === "request") {
      void answer(message.id, message.method, message.params);
    } else if (message.kind === "stopped") {
      stopReason = message.reason;
      for (const { reject } of pending.values()) reject(stoppedError(message.reason));
      pending.clear();
    }
  };

  const client: Record<string, unknown> = {
    get stopped() {
      return stopReason !== null;
    },
    onHostRequest(handler: HostRequestHandler) {
      hostRequestHandler = handler;
    },
  };
  for (const method of PLUGIN_API_METHODS) {
    const parts = method.split(".");
    let node = client;
    for (const part of parts.slice(0, -1)) {
      node[part] ??= {};
      node = node[part] as Record<string, unknown>;
    }
    node[parts[parts.length - 1]] = (params?: unknown) => call(method, params);
  }
  return client as unknown as PluginClient;
}
