/**
 * The host side of one Plugin's MessagePort (ADR 0019). Every call is checked
 * against the method table on arrival: size, call rate, method, input schema,
 * Plugin Permission (declared and granted, read again on every call so a
 * revocation applies to the next one), Library availability, and per-method
 * rate. Only then does the row's handler run. Refusals are typed errors and
 * the Plugin keeps running; only sustained throttling stops it.
 *
 * Events go only to Plugins that subscribed, and only while the event's
 * Plugin Permission is still granted at the moment of delivery.
 *
 * Handlers arrive per slice: a row without one refuses with `not-implemented`.
 */

import {
  PLUGIN_API_EVENTS,
  PLUGIN_API_RESERVED_NAMESPACES,
  PLUGIN_API_TABLE,
} from "@/features/plugins/api-table";
import type {
  PluginApiHandlers,
  PluginApiMethodId,
  PluginApiRow,
  PluginBroker,
  PluginBrokerOptions,
  PluginHandlerContext,
  PluginPermissionId,
  PluginStopReason,
  PluginStreamResult,
} from "@/features/plugins/types";
import {
  type HostToPluginMessage,
  PLUGIN_MESSAGE_MAX_BYTES,
  PLUGIN_STREAM_CHUNK_MAX_BYTES,
  PluginApiError,
  type PluginApiErrorCode,
  type PluginApiErrorData,
  type PendingReplies,
  isPluginApiErrorCode,
  messageTooLarge,
  utf8ByteLength,
} from "@/plugin-sdk/protocol";

export const CALL_RATE_PER_SECOND = 100;
export const CALL_BURST = 500;
/** Throttled this long without a break stops the Plugin. */
export const THROTTLE_STOP_MS = 30_000;
/**
 * A break ends a throttling streak once no call was refused for as long as
 * the bucket takes to refill completely (5 s): the Plugin gave back its whole
 * burst. A shorter pause is still sustained throttling.
 */
export const THROTTLE_GAP_MS = (CALL_BURST / CALL_RATE_PER_SECOND) * 1000;

// The SDK writes `kind`, `id`, then `method` or `event` first, so a refused
// message can be answered, with the method named, without decoding it.
const MESSAGE_HEAD =
  /^\{"kind":"(call|subscribe|unsubscribe|reply)","id":(\d{1,15})(?:,"(?:method|event)":"([A-Za-z0-9.]{1,128})")?/;

interface MessageHead {
  kind: string;
  id: number;
  method: string | undefined;
}

function readHead(text: string): MessageHead | null {
  const match = MESSAGE_HEAD.exec(text.slice(0, 200));
  return match ? { kind: match[1], id: Number(match[2]), method: match[3] } : null;
}

function malformedReply(): PluginApiErrorData {
  return { code: "internal-error", message: "The Plugin's reply was malformed" };
}

function refusal(
  code: PluginApiErrorCode,
  message: string,
  extra: Partial<PluginApiErrorData> = {}
): PluginApiErrorData {
  return { code, message, ...extra };
}

function hostMatches(host: string, pattern: string): boolean {
  if (pattern.startsWith("*.")) return host.endsWith(pattern.slice(1));
  return host === pattern;
}

function httpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

function describeIssue(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  const issue = error.issues[0];
  const path = issue.path.map(String).join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

function isStreamResult(value: unknown): value is PluginStreamResult<unknown, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "result" in value &&
    "body" in value &&
    typeof (value as { body: unknown }).body === "object"
  );
}

export function createPluginBroker(options: PluginBrokerOptions): PluginBroker {
  const { pluginId, port, declared, granted, handlers = {}, onStop } = options;
  const now = options.now ?? (() => performance.now());
  const isLibraryAvailable = options.isLibraryAvailable ?? (() => true);
  const rows = new Map((options.table ?? PLUGIN_API_TABLE).map((row) => [row.id, row]));
  const events = new Map((options.events ?? PLUGIN_API_EVENTS).map((row) => [row.id, row]));
  const reserved: readonly string[] = PLUGIN_API_RESERVED_NAMESPACES;

  let stopped = false;
  let tokens = CALL_BURST;
  let refilledAt = now();
  let throttledSince: number | null = null;
  let lastThrottledAt = 0;
  const lastAcceptedAt = new Map<string, number>();
  const subscriptions = new Set<string>();
  let nextRequestId = 1;
  const pending: PendingReplies = new Map();
  const pendingMethods = new Map<number, string>();
  const openBodies = new Set<AsyncIterator<unknown>>();

  function post(message: HostToPluginMessage) {
    if (!stopped) port.postMessage(message);
  }

  function fail(id: number, error: PluginApiErrorData) {
    post({ kind: "result", id, ok: false, error });
  }

  function takeToken(): boolean {
    const time = now();
    tokens = Math.min(CALL_BURST, tokens + ((time - refilledAt) * CALL_RATE_PER_SECOND) / 1000);
    refilledAt = time;
    if (tokens >= 1) {
      tokens -= 1;
      return true;
    }
    if (throttledSince === null || time - lastThrottledAt >= THROTTLE_GAP_MS) {
      throttledSince = time;
    }
    lastThrottledAt = time;
    return false;
  }

  function stop(reason: PluginStopReason) {
    if (stopped) return;
    port.postMessage({ kind: "stopped", reason } satisfies HostToPluginMessage);
    stopped = true;
    port.onmessage = null;
    for (const { reject } of pending.values()) {
      reject(new PluginApiError(refusal("plugin-stopped", `Plugin stopped: ${reason}`)));
    }
    pending.clear();
    pendingMethods.clear();
    subscriptions.clear();
    // Cancels each open body, so the network connection behind it closes now
    // instead of at its next chunk.
    for (const iterator of openBodies) void iterator.return?.();
    openBodies.clear();
    onStop?.(reason);
  }

  function holds(permission: PluginPermissionId): boolean {
    if (!declared.includes(permission)) return false;
    for (const current of granted()) if (current === permission) return true;
    return false;
  }

  function holdsNetworkHost(host: string): boolean {
    for (const current of granted()) {
      if (
        current.startsWith("network:") &&
        declared.includes(current) &&
        hostMatches(host, current.slice(8))
      ) {
        return true;
      }
    }
    return false;
  }

  /** Checks the row's Plugin Permission against already-parsed params. */
  function checkPermission(row: PluginApiRow, params: unknown): PluginApiErrorData | null {
    if (row.permission === null) return null;
    if (row.permission === "network") {
      const url = httpUrl((params as { url: string }).url);
      if (!url) {
        return refusal("invalid-params", "url: must be an http or https URL", { method: row.id });
      }
      const host = url.hostname.toLowerCase();
      if (holdsNetworkHost(host)) return null;
      return refusal("permission-denied", `Needs the Plugin Permission network:${host}`, {
        permission: `network:${host}`,
        method: row.id,
      });
    }
    if (holds(row.permission)) return null;
    return refusal("permission-denied", `Needs the Plugin Permission ${row.permission}`, {
      permission: row.permission,
      method: row.id,
    });
  }

  async function streamBody(row: PluginApiRow, id: number, body: AsyncIterable<unknown>) {
    const iterator = body[Symbol.asyncIterator]();
    openBodies.add(iterator);
    try {
      while (true) {
        const step = await iterator.next();
        if (stopped) return;
        if (step.done) break;
        const chunk = row.chunk?.parse(step.value);
        if (utf8ByteLength(JSON.stringify(chunk)) > PLUGIN_STREAM_CHUNK_MAX_BYTES) {
          throw new Error(`a ${row.id} chunk is over ${PLUGIN_STREAM_CHUNK_MAX_BYTES} bytes`);
        }
        post({ kind: "chunk", id, chunk });
      }
      post({ kind: "end", id });
    } catch (error) {
      void iterator.return?.();
      post({ kind: "end", id, error: handlerFailure(row.id, error) });
    } finally {
      openBodies.delete(iterator);
    }
  }

  function handlerFailure(method: string, error: unknown): PluginApiErrorData {
    if (error instanceof PluginApiError) {
      return refusal(error.code, error.message, { permission: error.permission, method });
    }
    console.error(`Plugin ${pluginId}: ${method} failed`, error);
    return refusal("internal-error", `${method} failed in Maibuk`, { method });
  }

  async function handleCall(id: number, method: string, params: unknown) {
    const namespace = method.split(".")[0];
    if (reserved.includes(namespace)) {
      fail(id, refusal("not-implemented", `${method} is not available yet`, { method }));
      return;
    }
    const row = rows.get(method);
    if (!row) {
      fail(id, refusal("unknown-method", `Unknown Plugin API method ${method}`, { method }));
      return;
    }
    const parsed = row.input.safeParse(params ?? {});
    if (!parsed.success) {
      fail(id, refusal("invalid-params", describeIssue(parsed.error), { method }));
      return;
    }
    const denied = checkPermission(row, parsed.data);
    if (denied) {
      fail(id, denied);
      return;
    }
    if (row.requiresLibrary && !isLibraryAvailable()) {
      fail(id, refusal("library-unavailable", "The Library is not available", { method }));
      return;
    }
    if (row.minIntervalMs !== undefined) {
      const last = lastAcceptedAt.get(method);
      if (last !== undefined && now() - last < row.minIntervalMs) {
        fail(
          id,
          refusal("rate-limited", `${method} allows one call every ${row.minIntervalMs} ms`, {
            method,
          })
        );
        return;
      }
    }

    const handler = (handlers as Record<string, PluginApiHandlers[PluginApiMethodId]>)[method];
    if (!handler) {
      fail(id, refusal("not-implemented", `${method} is not available yet`, { method }));
      return;
    }
    if (row.minIntervalMs !== undefined) lastAcceptedAt.set(method, now());

    let outcome: unknown;
    try {
      outcome = await (handler as (p: unknown, c: PluginHandlerContext) => unknown)(parsed.data, {
        pluginId,
      });
    } catch (error) {
      fail(id, handlerFailure(method, error));
      return;
    }
    if (row.chunk) {
      if (!isStreamResult(outcome)) {
        fail(id, handlerFailure(method, new Error(`${method} returned no body to stream`)));
        return;
      }
      post({ kind: "result", id, ok: true, result: outcome.result });
      await streamBody(row, id, outcome.body);
      return;
    }
    post({ kind: "result", id, ok: true, result: outcome });
  }

  function handleSubscription(kind: "subscribe" | "unsubscribe", id: number, event: string) {
    const row = events.get(event);
    if (!row) {
      fail(id, refusal("unknown-method", `Unknown Plugin API event ${event}`, { method: event }));
      return;
    }
    if (kind === "unsubscribe") {
      subscriptions.delete(event);
      post({ kind: "result", id, ok: true, result: null });
      return;
    }
    if (row.permission !== null && !holds(row.permission)) {
      fail(
        id,
        refusal("permission-denied", `Needs the Plugin Permission ${row.permission}`, {
          permission: row.permission,
          method: event,
        })
      );
      return;
    }
    subscriptions.add(event);
    post({ kind: "result", id, ok: true, result: null });
  }

  function handleReply(message: Record<string, unknown>) {
    const id = message.id;
    if (typeof id !== "number") return;
    const entry = pending.get(id);
    if (!entry) return;
    const method = pendingMethods.get(id);
    pending.delete(id);
    pendingMethods.delete(id);
    if (message.ok === true) {
      entry.resolve(message.result);
      return;
    }
    const error = message.error as Partial<PluginApiErrorData> | undefined;
    const code = isPluginApiErrorCode(error?.code) ? error.code : "internal-error";
    const text = typeof error?.message === "string" ? error.message : "";
    const permission = typeof error?.permission === "string" ? error.permission : undefined;
    entry.reject(new PluginApiError(refusal(code, text, { method, permission })));
  }

  port.onmessage = (event: MessageEvent) => {
    if (stopped) return;
    const data: unknown = event.data;
    const text = typeof data === "string" ? data : null;
    const head = text === null ? null : readHead(text);
    // A reply the host is waiting for passes even while throttled: the host asked
    // for it. The free pass settles that request whatever the message turns out
    // to be, so each host request buys at most one unmetered message.
    const awaitedReply = head?.kind === "reply" && pending.has(head.id) ? head : null;
    const refusable = head !== null && head.kind !== "reply" ? head : null;

    if (!awaitedReply && !takeToken()) {
      if (throttledSince !== null && now() - throttledSince >= THROTTLE_STOP_MS) {
        stop("throttled");
        return;
      }
      if (refusable) {
        fail(refusable.id, refusal("rate-limited", "Too many calls", { method: refusable.method }));
      }
      return;
    }
    if (text === null) return;
    // Cheap bound first: a UTF-16 unit is at most 3 UTF-8 bytes.
    if (
      text.length * 3 > PLUGIN_MESSAGE_MAX_BYTES &&
      utf8ByteLength(text) > PLUGIN_MESSAGE_MAX_BYTES
    ) {
      if (refusable) fail(refusable.id, messageTooLarge(refusable.method));
      if (awaitedReply) handleReply({ id: awaitedReply.id, ok: false, error: messageTooLarge() });
      return;
    }

    let message: unknown;
    try {
      message = JSON.parse(text);
    } catch {
      message = null;
    }
    const record =
      typeof message === "object" && message !== null ? (message as Record<string, unknown>) : null;
    if (awaitedReply) {
      // The head is read by a regex and the body by JSON.parse, which keeps the
      // last of duplicate keys; only a body that agrees with its head counts.
      const agrees = record?.kind === "reply" && record.id === awaitedReply.id;
      handleReply(
        agrees ? record : { id: awaitedReply.id, ok: false, error: malformedReply() }
      );
      return;
    }
    if (record === null) return;
    if (record.kind === "reply") {
      handleReply(record);
      return;
    }
    if (typeof record.id !== "number") return;
    if (record.kind === "call" && typeof record.method === "string") {
      void handleCall(record.id, record.method, record.params);
    } else if (
      (record.kind === "subscribe" || record.kind === "unsubscribe") &&
      typeof record.event === "string"
    ) {
      handleSubscription(record.kind, record.id, record.event);
    }
  };

  return {
    request(method, params) {
      if (stopped) {
        return Promise.reject(new PluginApiError(refusal("plugin-stopped", "Plugin stopped")));
      }
      const id = nextRequestId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        pendingMethods.set(id, method);
        port.postMessage({ kind: "request", id, method, params } satisfies HostToPluginMessage);
      });
    },
    emit(event, payload) {
      if (stopped || !subscriptions.has(event)) return false;
      const row = events.get(event);
      if (!row) return false;
      const checked = row.payload.parse(payload);
      if (row.permission !== null && !holds(row.permission)) return false;
      post({ kind: "event", event, payload: checked });
      return true;
    },
    stop,
    get stopped() {
      return stopped;
    },
  };
}
