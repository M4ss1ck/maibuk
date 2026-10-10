/**
 * The Maibuk Plugin SDK client: the whole Plugin API as namespaced,
 * promise-based methods over the one MessagePort the host gives the Plugin.
 * `maibuk.library.books.list()` sends a call to the host broker and resolves
 * with its result or rejects with a `PluginApiError`. `maibuk.on(event, fn)`
 * subscribes to an event and resolves with the function that unsubscribes.
 *
 * This entry point bundles into Plugins, so it imports only `src/plugin-sdk/`.
 */

import {
  PLUGIN_API_METHODS,
  PLUGIN_API_STREAMING_METHODS,
  type PluginApi,
  type PluginApiEventId,
  type PluginApiEvents,
} from "@/plugin-sdk/api.generated";
import {
  type HostToPluginMessage,
  PLUGIN_MESSAGE_MAX_BYTES,
  PluginApiError,
  type PluginApiErrorData,
  type PluginMessagePort,
  type PendingReplies,
  type PluginStreamListener,
  messageTooLarge,
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
  /**
   * Subscribes to an event. Rejects `permission-denied` when the event's
   * Plugin Permission is not granted. Resolves with the unsubscribe function.
   */
  on<E extends PluginApiEventId>(
    event: E,
    listener: (payload: PluginApiEvents[E]) => void
  ): Promise<() => Promise<void>>;
};

function stoppedError(reason: string): PluginApiError {
  return new PluginApiError({ code: "plugin-stopped", message: `Plugin stopped: ${reason}` });
}

export function createPluginClient(port: PluginMessagePort): PluginClient {
  let nextId = 1;
  let stopReason: string | null = null;
  let hostRequestHandler: HostRequestHandler | null = null;
  const pending: PendingReplies = new Map();
  const streams = new Map<number, PluginStreamListener<unknown>>();
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const streaming: ReadonlySet<string> = new Set(PLUGIN_API_STREAMING_METHODS);

  // `kind` and `id` lead, then `method` or `event`, so the broker can answer a
  // refused message without decoding it.
  function send(
    head: { kind: "call"; method: string; params: unknown } | { kind: "subscribe" | "unsubscribe"; event: string },
    listener?: PluginStreamListener<unknown>
  ): Promise<unknown> {
    if (stopReason !== null) return Promise.reject(stoppedError(stopReason));
    const id = nextId++;
    const text =
      head.kind === "call"
        ? JSON.stringify({ kind: head.kind, id, method: head.method, params: head.params ?? {} })
        : JSON.stringify({ kind: head.kind, id, event: head.event });
    if (utf8ByteLength(text) > PLUGIN_MESSAGE_MAX_BYTES) {
      const method = head.kind === "call" ? head.method : head.event;
      return Promise.reject(new PluginApiError(messageTooLarge(method)));
    }
    return new Promise((resolve, reject) => {
      pending.set(id, {
        resolve(value) {
          if (listener) streams.set(id, listener);
          resolve(value);
        },
        reject,
      });
      port.postMessage(text);
    });
  }

  // One host subscription per event, shared by every listener on it.
  const hostSubscriptions = new Map<string, Promise<unknown>>();

  async function subscribe(event: string, listener: (payload: unknown) => void) {
    let set = listeners.get(event);
    if (!set) {
      set = new Set();
      listeners.set(event, set);
    }
    set.add(listener);
    let ready = hostSubscriptions.get(event);
    if (!ready) {
      ready = send({ kind: "subscribe", event });
      hostSubscriptions.set(event, ready);
      ready.catch(() => hostSubscriptions.delete(event));
    }
    try {
      await ready;
    } catch (error) {
      set.delete(listener);
      throw error;
    }
    let active = true;
    return async () => {
      if (!active) return;
      active = false;
      set.delete(listener);
      if (set.size > 0) return;
      hostSubscriptions.delete(event);
      if (stopReason === null) await send({ kind: "unsubscribe", event });
    };
  }

  async function answer(id: number, method: string, params: unknown) {
    try {
      if (!hostRequestHandler) throw new Error(`No handler for ${method}`);
      const result = await hostRequestHandler(method, params);
      port.postMessage(JSON.stringify({ kind: "reply", id, ok: true, result: result ?? null }));
    } catch (error) {
      const data: PluginApiErrorData =
        error instanceof PluginApiError
          ? { code: error.code, message: error.message, permission: error.permission, method }
          : {
              code: "internal-error",
              message: error instanceof Error ? error.message : String(error),
              method,
            };
      port.postMessage(JSON.stringify({ kind: "reply", id, ok: false, error: data }));
    }
  }

  function endStream(id: number, error?: PluginApiError) {
    const listener = streams.get(id);
    if (!listener) return;
    streams.delete(id);
    listener.onEnd?.(error);
  }

  port.onmessage = (event: MessageEvent) => {
    const message = event.data as HostToPluginMessage;
    if (typeof message !== "object" || message === null) return;
    switch (message.kind) {
      case "result": {
        const entry = pending.get(message.id);
        if (!entry) return;
        pending.delete(message.id);
        if (message.ok) entry.resolve(message.result);
        else entry.reject(new PluginApiError(message.error));
        return;
      }
      case "chunk":
        streams.get(message.id)?.onChunk(message.chunk);
        return;
      case "end":
        endStream(message.id, message.error ? new PluginApiError(message.error) : undefined);
        return;
      case "event":
        for (const listener of listeners.get(message.event) ?? []) listener(message.payload);
        return;
      case "request":
        void answer(message.id, message.method, message.params);
        return;
      case "stopped": {
        stopReason = message.reason;
        for (const { reject } of pending.values()) reject(stoppedError(message.reason));
        pending.clear();
        for (const id of [...streams.keys()]) endStream(id, stoppedError(message.reason));
        listeners.clear();
        hostSubscriptions.clear();
        return;
      }
    }
  };

  const client: Record<string, unknown> = {
    get stopped() {
      return stopReason !== null;
    },
    onHostRequest(handler: HostRequestHandler) {
      hostRequestHandler = handler;
    },
    on: subscribe,
  };
  for (const method of PLUGIN_API_METHODS) {
    const parts = method.split(".");
    let node = client;
    for (const part of parts.slice(0, -1)) {
      node[part] ??= {};
      node = node[part] as Record<string, unknown>;
    }
    node[parts[parts.length - 1]] = streaming.has(method)
      ? (params?: unknown, listener?: PluginStreamListener<unknown>) =>
          send({ kind: "call", method, params }, listener)
      : (params?: unknown) => send({ kind: "call", method, params });
  }
  return client as unknown as PluginClient;
}
