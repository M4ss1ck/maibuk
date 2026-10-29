/**
 * The host side of one Plugin's MessagePort (ADR 0019). Every call is checked
 * against the method table on arrival: size, call rate, method, input schema,
 * Plugin Permission (declared and granted, read again on every call so a
 * revocation applies to the next one), Library availability, and per-method
 * rate. Only then does the row's handler run. Refusals are typed errors and
 * the Plugin keeps running; only sustained throttling stops it.
 *
 * A per-method rate limit does not apply while the host is awaiting this
 * Plugin's own `command.run`: a call it makes then is answering the author,
 * not announcing on its own. See `inFlightCommandRuns`.
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
  PluginEndpointSink,
  PluginHandlerContext,
  PluginPermissionId,
  PluginStopReason,
  PluginStreamResult,
} from "@/features/plugins/types";
import {
  type EndpointAnswer,
  type HostToPluginMessage,
  PLUGIN_COMMAND_RUN_REQUEST,
  PLUGIN_ENDPOINT_REQUEST,
  PLUGIN_MESSAGE_MAX_BYTES,
  PLUGIN_STREAM_CHUNK_MAX_BYTES,
  PluginApiError,
  type PluginApiErrorCode,
  type PluginApiErrorData,
  type PendingReplies,
  base64DecodedLength,
  isPluginApiErrorCode,
  messageTooLarge,
  utf8ByteLength,
} from "@/plugin-sdk/protocol";

export const CALL_RATE_PER_SECOND = 100;
export const CALL_BURST = 500;
/** Throttled this long without a break stops the Plugin. */
export const THROTTLE_STOP_MS = 30_000;
/**
 * How long a `command.run` exempts its Plugin from `minIntervalMs`. A run left
 * unanswered past it stops counting, so a Plugin cannot hold a run open to
 * toast without limit.
 */
export const COMMAND_RUN_EXEMPTION_MS = 10_000;
/**
 * A break ends a throttling streak once no call was refused for as long as
 * the bucket takes to refill completely (5 s): the Plugin gave back its whole
 * burst. A shorter pause is still sustained throttling.
 */
export const THROTTLE_GAP_MS = (CALL_BURST / CALL_RATE_PER_SECOND) * 1000;
/**
 * How long one Endpoint request may wait for the Plugin's answer head. The
 * socket gives up at 30 s (#586), so a Plugin that never replies is answered
 * 500 here and forgotten before that: an unanswered request must not sit in the
 * map for the rest of the session.
 */
export const ENDPOINT_ANSWER_DEADLINE_MS = 35_000;

/** The heartbeat's host request: it runs every beat, so it is never open work. */
const HEALTH_CHECK_METHOD = "health.check";

// The SDK writes `kind`, `id`, then `method` or `event` first, so a refused
// message can be answered, with the method named, without decoding it.
const MESSAGE_HEAD =
  /^\{"kind":"(call|subscribe|unsubscribe|reply|chunk|end)","id":(\d{1,15})(?:,"(?:method|event)":"([A-Za-z0-9.]{1,128})")?/;

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

function readEndpointHeaders(value: unknown): [string, string][] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const headers: [string, string][] = [];
  for (const pair of value) {
    if (
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      typeof pair[0] !== "string" ||
      typeof pair[1] !== "string"
    ) {
      return null;
    }
    headers.push([pair[0], pair[1]]);
  }
  return headers;
}

/** Reads a Plugin's Endpoint answer, or null when its shape is not the wire shape. */
function readEndpointAnswer(value: unknown): EndpointAnswer | null {
  if (typeof value !== "object" || value === null) return null;
  const answer = value as Record<string, unknown>;
  const status = answer.status;
  if (
    typeof status !== "number" ||
    !Number.isInteger(status) ||
    status < 100 ||
    status > 599 ||
    typeof answer.streaming !== "boolean"
  ) {
    return null;
  }
  const headers = readEndpointHeaders(answer.headers);
  if (headers === null) return null;
  if (answer.streaming) return { status, headers, streaming: true };
  if (answer.body === undefined) return { status, headers, streaming: false };
  if (typeof answer.body !== "string" || base64DecodedLength(answer.body) < 0) return null;
  return { status, headers, body: answer.body, streaming: false };
}

/**
 * One Endpoint request the Plugin has not finished answering. `chain` keeps
 * the sink's calls in message order even when `sink.chunk` returns a promise
 * (the Tauri sink crosses IPC). `responded` tells a stop whether the answer
 * head already went out, so it ends the stream rather than answering 500.
 * `deadline` is the host's own timer for the answer head; null once the head is
 * out or the entry is gone.
 */
interface OpenEndpoint {
  sink: PluginEndpointSink;
  responded: boolean;
  closed: boolean;
  chain: Promise<void>;
  deadline: ReturnType<typeof setTimeout> | null;
}

export function createPluginBroker(options: PluginBrokerOptions): PluginBroker {
  const { pluginId, port, declared, granted, handlers = {}, onStop, onCall } = options;
  const now = options.now ?? (() => performance.now());
  const isLibraryAvailable = options.isLibraryAvailable ?? (() => true);
  const trackLibraryWork = options.trackLibraryWork ?? (<T,>(work: Promise<T>) => work);
  const hasUserActivation =
    options.hasUserActivation ??
    (() =>
      (
        globalThis as {
          navigator?: { userActivation?: { isActive?: unknown } };
        }
      ).navigator?.userActivation?.isActive === true);
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
  /**
   * The ids of host `command.run` requests this Plugin has not answered yet.
   * While any is in flight the Plugin is running a Command the author picked,
   * so a call it makes in that window is answering the author rather than
   * announcing on its own: a method's `minIntervalMs` does not apply to it.
   * Such a call is accepted without touching `lastAcceptedAt`, so a solicited
   * announcement never eats into the budget for unsolicited ones and the
   * limit the author's own call would otherwise start does not begin until
   * the run settles. The id is dropped when the run settles (its reply, an
   * error, or a stop), and a run older than `COMMAND_RUN_EXEMPTION_MS` no
   * longer counts, so the exemption ends with the run or its window.
   */
  const inFlightCommandRuns = new Map<number, number>();
  /** Endpoint requests whose answer has not finished, by host request id. */
  const endpoints = new Map<number, OpenEndpoint>();
  /** Plugin calls whose handler (and any streamed body) has not finished. */
  let openCalls = 0;

  function hasRecentCommandRun(): boolean {
    const time = now();
    for (const sentAt of inFlightCommandRuns.values()) {
      if (time - sentAt < COMMAND_RUN_EXEMPTION_MS) return true;
    }
    return false;
  }

  function hasOpenWork(): boolean {
    if (openCalls > 0 || endpoints.size > 0) return true;
    for (const method of pendingMethods.values()) {
      if (method !== HEALTH_CHECK_METHOD) return true;
    }
    return false;
  }

  function post(message: HostToPluginMessage, transfer?: Transferable[]) {
    if (!stopped) port.postMessage(message, transfer);
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
    inFlightCommandRuns.clear();
    subscriptions.clear();
    // Cancels each open body, so the network connection behind it closes now
    // instead of at its next chunk.
    for (const iterator of openBodies) void iterator.return?.();
    openBodies.clear();
    // An answer already streaming can only be ended; one still waiting for its
    // head is answered 500, the same as a Plugin that stopped before answering.
    for (const open of endpoints.values()) {
      if (open.closed) continue;
      open.closed = true;
      clearDeadline(open);
      if (open.responded) open.sink.end();
      else open.sink.respond(500, [], undefined, false);
    }
    endpoints.clear();
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

  function queueEndpoint(open: OpenEndpoint, step: () => void | Promise<void>) {
    open.chain = open.chain.then(step).catch((error: unknown) => {
      console.error(`Plugin ${pluginId}: an endpoint answer failed`, error);
    });
  }

  function clearDeadline(open: OpenEndpoint) {
    if (open.deadline === null) return;
    clearTimeout(open.deadline);
    open.deadline = null;
  }

  /** Takes an open answer out of the map for good: its deadline is cleared too. */
  function forgetEndpoint(id: number): OpenEndpoint | undefined {
    const open = endpoints.get(id);
    if (!open) return undefined;
    endpoints.delete(id);
    clearDeadline(open);
    return open;
  }

  /** Ends an open answer once, keeping it behind any chunk already queued. */
  function closeEndpoint(id: number) {
    const open = forgetEndpoint(id);
    if (!open || open.closed) return;
    queueEndpoint(open, () => {
      if (open.closed) return;
      open.closed = true;
      open.sink.end();
    });
  }

  /**
   * The Plugin never answered: the caller gets a 500 and the entry is dropped,
   * so nothing later reaches a connection that is already gone.
   */
  function expireEndpoint(id: number) {
    const open = forgetEndpoint(id);
    if (!open || open.closed) return;
    open.closed = true;
    open.sink.respond(500, [], undefined, false);
  }

  function handleEndpointReply(id: number, ok: boolean, value: unknown) {
    const open = endpoints.get(id);
    if (!open || open.closed) return;
    const answer = ok ? readEndpointAnswer(value) : null;
    if (answer === null) {
      forgetEndpoint(id);
      open.closed = true;
      open.sink.respond(500, [], undefined, false);
      return;
    }
    if (answer.streaming) {
      open.responded = true;
      // The head is out: the deadline was for the answer, not for a stream
      // that is now the caller's to read.
      clearDeadline(open);
      open.sink.respond(answer.status, answer.headers, undefined, true);
      return;
    }
    forgetEndpoint(id);
    open.closed = true;
    open.sink.respond(answer.status, answer.headers, answer.body, false);
  }

  function handleEndpointChunk(id: number, chunk: unknown) {
    const open = endpoints.get(id);
    // A chunk before the answer's head, or after it closed, is dropped: the
    // protocol says chunks follow a `reply` that said `streaming`.
    if (!open || open.closed || !open.responded) return;
    const length = typeof chunk === "string" ? base64DecodedLength(chunk) : -1;
    if (length < 0 || length > PLUGIN_STREAM_CHUNK_MAX_BYTES) {
      closeEndpoint(id);
      return;
    }
    queueEndpoint(open, async () => {
      if (open.closed) return;
      if ((await open.sink.chunk(chunk as string)) === false) {
        // The caller hung up: the rest of this stream is dropped, so the Plugin
        // cannot keep writing bytes into a closed connection.
        open.closed = true;
        forgetEndpoint(id);
      }
    });
  }

  function handleEndpointEnd(id: number) {
    const open = endpoints.get(id);
    if (!open || open.closed || !open.responded) return;
    closeEndpoint(id);
  }

  function handleEndpointMessage(message: Record<string, unknown>) {
    if (typeof message.id !== "number") return;
    if (!endpoints.has(message.id)) return;
    if (message.kind === "chunk") handleEndpointChunk(message.id, message.chunk);
    else if (message.kind === "end") handleEndpointEnd(message.id);
  }

  async function handleCall(id: number, method: string, params: unknown) {
    onCall?.(method);
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
    if (row.requiresUserAction && !hasRecentCommandRun() && !hasUserActivation()) {
      fail(
        id,
        refusal(
          "user-action-required",
          `${method} needs the author's click, key press, or Command run`,
          { method }
        )
      );
      return;
    }
    // While the host awaits this Plugin's own `command.run`, a call with a
    // `minIntervalMs` is answering the author: accept it, and leave
    // `lastAcceptedAt` alone so solicited announcements do not consume the
    // unsolicited budget (see `inFlightCommandRuns`).
    const solicited = hasRecentCommandRun();
    if (row.minIntervalMs !== undefined && !solicited) {
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
    if (row.minIntervalMs !== undefined && !solicited) lastAcceptedAt.set(method, now());

    let outcome: unknown;
    try {
      // A `requiresLibrary` handler runs against exactly one Library.
      // Registering it lets the Tutorial switch wait for accepted calls before
      // switching, and the re-check below keeps a late result from crossing
      // into the replacement Library (ADR 0008, #398).
      const executed = Promise.resolve(
        (handler as (p: unknown, c: PluginHandlerContext) => unknown)(parsed.data, { pluginId })
      );
      outcome = await (row.requiresLibrary ? trackLibraryWork(executed) : executed);
    } catch (error) {
      fail(id, handlerFailure(method, error));
      return;
    }
    if (row.requiresLibrary && !isLibraryAvailable()) {
      fail(id, refusal("library-unavailable", "The Library is not available", { method }));
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
    if (outcome instanceof ArrayBuffer) {
      // `files.read` hands its bytes over rather than copying them, so a large
      // range crosses the port once.
      post({ kind: "result", id, ok: true, result: outcome }, [outcome]);
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
    // A replaying event delivers its current value on subscription, so a Plugin
    // that starts after the change still learns it and no change is missed
    // between startup and subscription. The subscription is registered and its
    // reply posted first, so the Plugin's listener exists when this arrives.
    if (row.replays) {
      const snapshot = options.eventSnapshot?.(event);
      if (snapshot !== undefined) post({ kind: "event", event, payload: row.payload.parse(snapshot) });
    }
  }

  function handleReply(message: Record<string, unknown>) {
    const id = message.id;
    if (typeof id !== "number") return;
    const entry = pending.get(id);
    if (!entry) return;
    const method = pendingMethods.get(id);
    pending.delete(id);
    pendingMethods.delete(id);
    inFlightCommandRuns.delete(id);
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
    // for it. The same goes for an Endpoint answer's `chunk`/`end`, keyed by the
    // request the host sent. The free pass settles that request whatever the
    // message turns out to be, so an unanswered `command.run` buys one unmetered
    // reply. An Endpoint answer is not one message: every `chunk` of a stream the
    // host opened passes unmetered, bounded by the stream the Plugin itself ends.
    const awaited =
      head !== null &&
      (head.kind === "reply"
        ? pending.has(head.id) || endpoints.has(head.id)
        : (head.kind === "chunk" || head.kind === "end") && endpoints.has(head.id))
        ? head
        : null;
    const refusable = head !== null && head.kind !== "reply" ? head : null;

    if (!awaited && !takeToken()) {
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
      if (awaited?.kind === "reply") {
        if (endpoints.has(awaited.id)) handleEndpointReply(awaited.id, false, undefined);
        else handleReply({ id: awaited.id, ok: false, error: messageTooLarge() });
      } else if (awaited !== null) {
        closeEndpoint(awaited.id);
      }
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
    if (awaited !== null) {
      // The head is read by a regex and the body by JSON.parse, which keeps the
      // last of duplicate keys; only a body that agrees with its head counts.
      const agrees = record?.kind === awaited.kind && record.id === awaited.id;
      if (awaited.kind === "reply") {
        if (endpoints.has(awaited.id)) {
          handleEndpointReply(awaited.id, agrees && record?.ok === true, record?.result);
        } else {
          handleReply(
            agrees
              ? (record as Record<string, unknown>)
              : { id: awaited.id, ok: false, error: malformedReply() }
          );
        }
      } else if (!agrees) {
        closeEndpoint(awaited.id);
      } else {
        handleEndpointMessage(record as Record<string, unknown>);
      }
      return;
    }
    if (record === null) return;
    if (record.kind === "reply") {
      handleReply(record);
      return;
    }
    // A chunk or end with no open endpoint request behind it (an unknown id, a
    // duplicate, or a late one) is dropped.
    if (record.kind === "chunk" || record.kind === "end") return;
    if (typeof record.id !== "number") return;
    if (record.kind === "call" && typeof record.method === "string") {
      openCalls += 1;
      void handleCall(record.id, record.method, record.params).finally(() => {
        openCalls -= 1;
      });
    } else if (
      (record.kind === "subscribe" || record.kind === "unsubscribe") &&
      typeof record.event === "string"
    ) {
      handleSubscription(record.kind, record.id, record.event);
    }
  };

  return {
    request(method, params, transfer) {
      if (stopped) {
        return Promise.reject(new PluginApiError(refusal("plugin-stopped", "Plugin stopped")));
      }
      const id = nextRequestId++;
      if (method === PLUGIN_COMMAND_RUN_REQUEST) inFlightCommandRuns.set(id, now());
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        pendingMethods.set(id, method);
        port.postMessage(
          { kind: "request", id, method, params } satisfies HostToPluginMessage,
          transfer ?? []
        );
      });
    },
    requestEndpoint(request, sink) {
      // The grant is read again here, on the one path an outside caller can
      // reach, so a revoked `serve` stops new requests without a restart.
      if (stopped || !holds("serve")) {
        sink.respond(404, [], undefined, false);
        return;
      }
      const id = nextRequestId++;
      const open: OpenEndpoint = {
        sink,
        responded: false,
        closed: false,
        chain: Promise.resolve(),
        deadline: null,
      };
      endpoints.set(id, open);
      open.deadline = setTimeout(() => expireEndpoint(id), ENDPOINT_ANSWER_DEADLINE_MS);
      port.postMessage({
        kind: "request",
        id,
        method: PLUGIN_ENDPOINT_REQUEST,
        params: request,
      } satisfies HostToPluginMessage);
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
    hasOpenWork,
    get stopped() {
      return stopped;
    },
  };
}
