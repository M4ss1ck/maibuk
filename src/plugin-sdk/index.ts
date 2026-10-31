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
  type EndpointAnswer,
  type EndpointRequest,
  type HostToPluginMessage,
  PLUGIN_ENDPOINT_REQUEST,
  PLUGIN_FRAME_MESSAGE,
  PLUGIN_MESSAGE_MAX_BYTES,
  PLUGIN_STREAM_CHUNK_MAX_BYTES,
  PluginApiError,
  type PluginApiErrorData,
  type PluginFrame,
  type PluginFrameMessage,
  type PluginMessagePort,
  type PluginStartReason,
  type PendingReplies,
  type PluginStreamListener,
  base64ToBytes,
  bytesToBase64,
  isPluginInitMessage,
  messageTooLarge,
  utf8ByteLength,
} from "@/plugin-sdk/protocol";

export * from "@/plugin-sdk/api.generated";
export * from "@/plugin-sdk/protocol";
export * from "@/plugin-sdk/ui";

export type HostRequestHandler = (method: string, params: unknown) => unknown;

/**
 * One Endpoint request as the SDK hands it to an author's handler: the raw
 * request body as bytes, with `text()` for the common UTF-8 case.
 */
export interface PluginEndpointRequest {
  method: string;
  /** The full request path including the query, e.g. `/plugin/acme/mcp?x=1`. */
  path: string;
  /** Request headers, names lower-cased, duplicates kept in order. */
  headers: [string, string][];
  /** The raw request bytes. */
  body: Uint8Array;
  /** The body decoded as UTF-8 text. */
  text(): string;
}

/** An Endpoint answer's body: bytes, text, or a stream of either. */
export type PluginEndpointBody = string | Uint8Array | AsyncIterable<string | Uint8Array>;

/** What an Endpoint handler returns. An `AsyncIterable` body streams. */
export interface PluginEndpointAnswer {
  status: number;
  /** Response headers; duplicates are kept when given as pairs. */
  headers?: Record<string, string> | [string, string][];
  body?: PluginEndpointBody;
}

export type EndpointRequestHandler = (
  request: PluginEndpointRequest
) => PluginEndpointAnswer | Promise<PluginEndpointAnswer>;

/** Why the host activated this Plugin, as the host announced it (#400, #445). */
export interface PluginActivation {
  readonly startReason: PluginStartReason;
}

export type PluginClient = PluginApi & {
  /** True once the host stopped this Plugin; every call then rejects `plugin-stopped`. */
  readonly stopped: boolean;
  /**
   * The activation context the host announced on the port as the init message,
   * or null before it arrives (#445). The host posts it before any other host
   * message, so a Plugin that reads it at startup always sees its reason.
   */
  readonly activation: PluginActivation | null;
  /** Answers the host's requests to this Plugin (health checks, migrateData, Command runs). */
  onHostRequest(handler: HostRequestHandler): void;
  /**
   * Answers the host's Endpoint requests: one handler for every request that
   * reaches `/plugin/<pluginId>/…` while the Plugin holds the `serve` Plugin
   * Permission. With no handler registered every request is answered 404.
   * Answer with a `status`, optional `headers`, and `body`; an `AsyncIterable`
   * body streams, and the handler then must not `await` the request's
   * completion — the host follows the chunks with one `end`.
   */
  onEndpointRequest(handler: EndpointRequestHandler): void;
  /**
   * Subscribes to an event. Rejects `permission-denied` when the event's
   * Plugin Permission is not granted. Resolves with the unsubscribe function.
   */
  on<E extends PluginApiEventId>(
    event: E,
    listener: (payload: PluginApiEvents[E]) => void
  ): Promise<() => Promise<void>>;
  /**
   * Subscribes to the Frames the host hands this Plugin (#454, D1): one call
   * per mounted Frame, with the Frame's own MessagePort. The handoff arrives on
   * the Plugin's MessagePort as a reserved envelope and is settled before RPC
   * dispatch, so no RPC handler ever sees it. The Plugin relays messages
   * between this Worker and that Frame over the port; the host never parses
   * them. Returns the function that unsubscribes.
   */
  onFrame(handler: (frame: PluginFrame) => void): () => void;
};

function stoppedError(reason: string): PluginApiError {
  return new PluginApiError({ code: "plugin-stopped", message: `Plugin stopped: ${reason}` });
}

export function createPluginClient(port: PluginMessagePort): PluginClient {
  let nextId = 1;
  let stopReason: string | null = null;
  let hostRequestHandler: HostRequestHandler | null = null;
  let endpointRequestHandler: EndpointRequestHandler | null = null;
  let activationContext: PluginActivation | null = null;
  const pending: PendingReplies = new Map();
  const streams = new Map<number, PluginStreamListener<unknown>>();
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  // The Frames the host handed this Plugin (#454). Each arrives on the Plugin's
  // own MessagePort as a reserved envelope carrying the Frame's port in the
  // transfer list, handled before RPC dispatch so a Plugin RPC handler never
  // sees it; the host never parses the Frame<->Worker traffic that follows.
  const frameHandlers = new Set<(frame: PluginFrame) => void>();
  const streaming: ReadonlySet<string> = new Set(PLUGIN_API_STREAMING_METHODS);

  // `kind` and `id` lead, then `method` or `event`, so the broker can answer a
  // refused message without decoding it.
  function send(
    head:
      | { kind: "call"; method: string; params: unknown }
      | { kind: "subscribe" | "unsubscribe"; event: string },
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

  function postAnswer(id: number, answer: EndpointAnswer) {
    port.postMessage(JSON.stringify({ kind: "reply", id, ok: true, result: answer }));
  }

  function headersOf(headers: PluginEndpointAnswer["headers"]): [string, string][] {
    if (headers === undefined) return [];
    if (Array.isArray(headers)) return headers.map(([name, value]) => [name, value]);
    return Object.entries(headers);
  }

  function isAsyncIterable(value: unknown): value is AsyncIterable<string | Uint8Array> {
    return (
      typeof value === "object" &&
      value !== null &&
      typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function"
    );
  }

  function bytesOf(body: string | Uint8Array): Uint8Array {
    return typeof body === "string" ? new TextEncoder().encode(body) : body;
  }

  /** Posts one body piece as `chunk`s, none over the stream cap (the host caps each). */
  function postChunks(id: number, bytes: Uint8Array) {
    for (let offset = 0; offset < bytes.length; offset += PLUGIN_STREAM_CHUNK_MAX_BYTES) {
      const slice = bytes.subarray(offset, offset + PLUGIN_STREAM_CHUNK_MAX_BYTES);
      port.postMessage(JSON.stringify({ kind: "chunk", id, chunk: bytesToBase64(slice) }));
    }
  }

  /**
   * Answers one Endpoint request. A streamed body is a `reply` saying
   * `streaming`, then its `chunk`s and one `end`; a handler that throws fails
   * the reply (the host answers 500), and a stream that throws still ends, so
   * the host closes its response instead of waiting.
   */
  async function answerEndpoint(id: number, request: EndpointRequest) {
    const handler = endpointRequestHandler;
    if (!handler) {
      postAnswer(id, { status: 404, headers: [], streaming: false });
      return;
    }
    let answer: PluginEndpointAnswer;
    try {
      const body = base64ToBytes(request.body);
      const input: PluginEndpointRequest = {
        method: request.method,
        path: request.path,
        headers: request.headers.map(([name, value]) => [name, value]),
        body,
        text: () => new TextDecoder().decode(body),
      };
      answer = await handler(input);
    } catch (error) {
      const data: PluginApiErrorData =
        error instanceof PluginApiError
          ? { code: error.code, message: error.message, permission: error.permission }
          : {
              code: "internal-error",
              message: error instanceof Error ? error.message : String(error),
            };
      port.postMessage(
        JSON.stringify({
          kind: "reply",
          id,
          ok: false,
          error: { ...data, method: PLUGIN_ENDPOINT_REQUEST },
        })
      );
      return;
    }
    if (typeof answer !== "object" || answer === null || typeof answer.status !== "number") {
      port.postMessage(
        JSON.stringify({
          kind: "reply",
          id,
          ok: false,
          error: {
            code: "internal-error",
            message: "The endpoint handler returned no answer",
            method: PLUGIN_ENDPOINT_REQUEST,
          },
        })
      );
      return;
    }
    const headers = headersOf(answer.headers);
    if (isAsyncIterable(answer.body)) {
      postAnswer(id, { status: answer.status, headers, streaming: true });
      try {
        for await (const piece of answer.body) postChunks(id, bytesOf(piece));
      } catch {
        // The answer is already open; ending it closes the host's response.
      }
      port.postMessage(JSON.stringify({ kind: "end", id }));
      return;
    }
    const body = answer.body === undefined ? null : bytesOf(answer.body);
    postAnswer(id, {
      status: answer.status,
      headers,
      ...(body === null ? {} : { body: bytesToBase64(body) }),
      streaming: false,
    });
  }

  async function answer(id: number, method: string, params: unknown) {
    if (method === PLUGIN_ENDPOINT_REQUEST) {
      await answerEndpoint(id, params as EndpointRequest);
      return;
    }
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

  /** Delivers one host Frame handoff to every `onFrame` subscriber. */
  function deliverFrame(event: MessageEvent): void {
    const port = event.ports[0];
    const handoff = event.data as PluginFrameMessage;
    if (port === undefined) return;
    const frame: PluginFrame = { id: handoff.frameId, src: handoff.src, port };
    for (const handler of [...frameHandlers]) handler(frame);
  }

  function onFrame(handler: (frame: PluginFrame) => void): () => void {
    frameHandlers.add(handler);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      frameHandlers.delete(handler);
    };
  }

  port.onmessage = (event: MessageEvent) => {
    const message: unknown = event.data;
    if (typeof message !== "object" || message === null) return;
    if (isPluginInitMessage(message)) {
      if (message.startReason !== undefined) {
        activationContext = { startReason: message.startReason };
      }
      return;
    }
    // The reserved Frame handoff (#454) is settled here, before RPC dispatch,
    // and never reaches a Plugin RPC handler or the `on` event map.
    if ((message as { kind?: unknown }).kind === PLUGIN_FRAME_MESSAGE.kind) {
      deliverFrame(event);
      return;
    }
    const hostMessage = message as HostToPluginMessage;
    switch (hostMessage.kind) {
      case "result": {
        const entry = pending.get(hostMessage.id);
        if (!entry) return;
        pending.delete(hostMessage.id);
        if (hostMessage.ok) entry.resolve(hostMessage.result);
        else entry.reject(new PluginApiError(hostMessage.error));
        return;
      }
      case "chunk":
        streams.get(hostMessage.id)?.onChunk(hostMessage.chunk);
        return;
      case "end":
        endStream(
          hostMessage.id,
          hostMessage.error ? new PluginApiError(hostMessage.error) : undefined
        );
        return;
      case "event":
        for (const listener of listeners.get(hostMessage.event) ?? [])
          listener(hostMessage.payload);
        return;
      case "request":
        void answer(hostMessage.id, hostMessage.method, hostMessage.params);
        return;
      case "stopped": {
        stopReason = hostMessage.reason;
        for (const { reject } of pending.values()) reject(stoppedError(hostMessage.reason));
        pending.clear();
        for (const id of [...streams.keys()]) endStream(id, stoppedError(hostMessage.reason));
        listeners.clear();
        hostSubscriptions.clear();
        frameHandlers.clear();
        endpointRequestHandler = null;
        return;
      }
    }
  };

  const client: Record<string, unknown> = {
    get stopped() {
      return stopReason !== null;
    },
    get activation() {
      return activationContext;
    },
    onHostRequest(handler: HostRequestHandler) {
      hostRequestHandler = handler;
    },
    onEndpointRequest(handler: EndpointRequestHandler) {
      endpointRequestHandler = handler;
    },
    on: subscribe,
    onFrame,
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
