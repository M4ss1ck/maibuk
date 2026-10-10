/**
 * The host side of one Plugin's MessagePort (ADR 0019). Every call is checked
 * against the method table on arrival: size, call rate, method, Plugin
 * Permission (declared and granted, read again on every call so a revocation
 * applies to the next one), Library availability, per-method rate, and input
 * schema. Only then does the row's handler run. Refusals are typed errors and
 * the Plugin keeps running; only sustained throttling stops it.
 *
 * Handlers arrive per slice: a row without one refuses with `not-implemented`.
 */

import {
  PLUGIN_API_RESERVED_NAMESPACES,
  PLUGIN_API_TABLE,
  type PluginApiInput,
  type PluginApiMethodId,
  type PluginApiOutput,
  type PluginApiRow,
} from "@/features/plugins/api-table";
import {
  type HostToPluginMessage,
  PLUGIN_MESSAGE_MAX_BYTES,
  PluginApiError,
  type PluginApiErrorCode,
  type PluginApiErrorData,
  utf8ByteLength,
} from "@/plugin-sdk/protocol";

export const CALL_RATE_PER_SECOND = 100;
export const CALL_BURST = 500;
/** Throttled this long without a break stops the Plugin. */
export const THROTTLE_STOP_MS = 30_000;
/** A gap this long with no refused call ends a throttling streak. */
export const THROTTLE_GAP_MS = 1_000;

export type PluginStopReason = "throttled" | "requested";

export interface PluginHandlerContext {
  pluginId: string;
}

export type PluginApiHandlers = {
  [M in PluginApiMethodId]?: (
    params: PluginApiInput<M>,
    context: PluginHandlerContext
  ) => Promise<PluginApiOutput<M>> | PluginApiOutput<M>;
};

/** The subset of `MessagePort` the broker uses. */
export interface PluginPort {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent) => void) | null;
}

export interface PluginBrokerOptions {
  pluginId: string;
  port: PluginPort;
  /** Every Plugin Permission the manifest declares, required and optional. */
  declared: readonly string[];
  /** The Plugin Permissions granted right now; read on every call. */
  granted: () => Iterable<string>;
  handlers?: PluginApiHandlers;
  /** False while the Library cannot be read or written (Library rows refuse). */
  isLibraryAvailable?: () => boolean;
  onStop?: (reason: PluginStopReason) => void;
  now?: () => number;
  table?: readonly PluginApiRow[];
}

export interface PluginBroker {
  /** Sends a host to Plugin request; settles on the Plugin's first reply with its id. */
  request(method: string, params: unknown): Promise<unknown>;
  stop(reason: PluginStopReason): void;
  readonly stopped: boolean;
}

// The SDK writes `kind` then `id` first, so the id of a refused call is
// readable without decoding the whole message.
const CALL_ID_PREFIX = /^\{"kind":"call","id":(\d{1,15}),/;

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

function effectivePermissions(declared: readonly string[], granted: Iterable<string>): Set<string> {
  const declaredSet = new Set(declared);
  const effective = new Set<string>();
  for (const permission of granted) {
    if (declaredSet.has(permission)) effective.add(permission);
  }
  return effective;
}

function describeIssue(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  const issue = error.issues[0];
  const path = issue.path.map(String).join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

export function createPluginBroker(options: PluginBrokerOptions): PluginBroker {
  const { pluginId, port, declared, granted, handlers = {}, onStop } = options;
  const now = options.now ?? (() => performance.now());
  const isLibraryAvailable = options.isLibraryAvailable ?? (() => true);
  const rows = new Map((options.table ?? PLUGIN_API_TABLE).map((row) => [row.id, row]));
  const reserved: readonly string[] = PLUGIN_API_RESERVED_NAMESPACES;

  let stopped = false;
  let tokens = CALL_BURST;
  let refilledAt = now();
  let throttledSince: number | null = null;
  let lastThrottledAt = 0;
  const lastAcceptedAt = new Map<string, number>();
  let nextRequestId = 1;
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: unknown) => void }
  >();

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
    if (throttledSince === null || time - lastThrottledAt > THROTTLE_GAP_MS) {
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
    onStop?.(reason);
  }

  function checkPermission(row: PluginApiRow, params: unknown): PluginApiErrorData | null {
    if (row.permission === null) return null;
    const effective = effectivePermissions(declared, granted());
    if (row.permission === "network") {
      const url = new URL((params as { url: string }).url);
      const host = url.hostname.toLowerCase();
      for (const permission of effective) {
        if (permission.startsWith("network:") && hostMatches(host, permission.slice(8))) {
          return null;
        }
      }
      return refusal("permission-denied", `Needs the Plugin Permission network:${host}`, {
        permission: `network:${host}`,
        method: row.id,
      });
    }
    if (effective.has(row.permission)) return null;
    return refusal("permission-denied", `Needs the Plugin Permission ${row.permission}`, {
      permission: row.permission,
      method: row.id,
    });
  }

  function validNetworkUrl(params: unknown): boolean {
    try {
      const url = new URL((params as { url: string }).url);
      return url.protocol === "https:" || url.protocol === "http:";
    } catch {
      return false;
    }
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

    if (row.permission !== "network") {
      const denied = checkPermission(row, params);
      if (denied) return fail(id, denied);
    }
    const parsed = row.input.safeParse(params ?? {});
    if (!parsed.success) {
      fail(id, refusal("invalid-params", describeIssue(parsed.error), { method }));
      return;
    }
    if (row.permission === "network") {
      if (!validNetworkUrl(parsed.data)) {
        fail(id, refusal("invalid-params", "url: must be an http or https URL", { method }));
        return;
      }
      const denied = checkPermission(row, parsed.data);
      if (denied) return fail(id, denied);
    }
    if (row.requiresLibrary && !isLibraryAvailable()) {
      fail(id, refusal("library-unavailable", "The Library is not available", { method }));
      return;
    }
    if (row.minIntervalMs !== undefined) {
      const last = lastAcceptedAt.get(method);
      const time = now();
      if (last !== undefined && time - last < row.minIntervalMs) {
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

    try {
      const result = await (handler as (p: unknown, c: PluginHandlerContext) => unknown)(
        parsed.data,
        { pluginId }
      );
      post({ kind: "result", id, ok: true, result });
    } catch (error) {
      if (error instanceof PluginApiError) {
        fail(id, refusal(error.code, error.message, { permission: error.permission, method }));
        return;
      }
      console.error(`Plugin ${pluginId}: ${method} failed`, error);
      fail(id, refusal("internal-error", `${method} failed in Maibuk`, { method }));
    }
  }

  function handleReply(message: Record<string, unknown>) {
    const id = message.id;
    if (typeof id !== "number") return;
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    if (message.ok === true) entry.resolve(message.result);
    else {
      const error = message.error as Partial<PluginApiErrorData> | undefined;
      entry.reject(
        new PluginApiError(
          refusal("internal-error", typeof error?.message === "string" ? error.message : "")
        )
      );
    }
  }

  port.onmessage = (event: MessageEvent) => {
    if (stopped) return;
    const data: unknown = event.data;
    const text = typeof data === "string" ? data : null;
    const sniffed = text === null ? null : CALL_ID_PREFIX.exec(text.slice(0, 64));
    const callId = sniffed ? Number(sniffed[1]) : null;

    if (!takeToken()) {
      if (throttledSince !== null && now() - throttledSince >= THROTTLE_STOP_MS) {
        stop("throttled");
        return;
      }
      if (callId !== null) fail(callId, refusal("rate-limited", "Too many calls"));
      return;
    }
    if (text === null) return;
    // Cheap bound first: a UTF-16 unit is at most 3 UTF-8 bytes.
    if (
      text.length * 3 > PLUGIN_MESSAGE_MAX_BYTES &&
      utf8ByteLength(text) > PLUGIN_MESSAGE_MAX_BYTES
    ) {
      if (callId !== null) {
        fail(callId, refusal("message-too-large", "Messages to Maibuk are capped at 4 MB"));
      }
      return;
    }

    let message: unknown;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (typeof message !== "object" || message === null) return;
    const record = message as Record<string, unknown>;
    if (record.kind === "reply") {
      handleReply(record);
      return;
    }
    if (
      record.kind === "call" &&
      typeof record.id === "number" &&
      typeof record.method === "string"
    ) {
      void handleCall(record.id, record.method, record.params);
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
        port.postMessage({ kind: "request", id, method, params } satisfies HostToPluginMessage);
      });
    },
    stop,
    get stopped() {
      return stopped;
    },
  };
}
