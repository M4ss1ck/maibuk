/**
 * The wire protocol between a Plugin and Maibuk's broker over one
 * MessagePort. Shared by the SDK client and the host broker; this file must
 * not import host code, because Plugins bundle it.
 *
 * Plugin to host messages are JSON strings so the broker can refuse an
 * oversized message by its length before decoding it. Each one starts with
 * `kind`, `id`, then `method` or `event`, so a refusal can name the call
 * without decoding the rest. Host to Plugin messages are plain objects and
 * uncapped.
 */

export const PLUGIN_API_ERROR_CODES = [
  "permission-denied",
  "unknown-method",
  "invalid-params",
  "rate-limited",
  "plugin-stopped",
  "library-unavailable",
  "not-implemented",
  "message-too-large",
  "internal-error",
] as const;

export type PluginApiErrorCode = (typeof PLUGIN_API_ERROR_CODES)[number];

export interface PluginApiErrorData {
  code: PluginApiErrorCode;
  message: string;
  /** The missing Plugin Permission, on `permission-denied`. */
  permission?: string;
  /** The method or event the error is about. */
  method?: string;
}

export function isPluginApiErrorCode(value: unknown): value is PluginApiErrorCode {
  return (PLUGIN_API_ERROR_CODES as readonly unknown[]).includes(value);
}

/** Largest Plugin to host message, in UTF-8 bytes (the broker decodes on the main thread). */
export const PLUGIN_MESSAGE_MAX_BYTES = 4 * 1024 * 1024;

/** Largest streamed body chunk, serialized, in UTF-8 bytes (keeps typing smooth during downloads). */
export const PLUGIN_STREAM_CHUNK_MAX_BYTES = 64 * 1024;

export function messageTooLarge(method?: string): PluginApiErrorData {
  return { code: "message-too-large", message: "Messages to Maibuk are capped at 4 MB", method };
}

export type PluginToHostMessage =
  | { kind: "call"; id: number; method: string; params: unknown }
  | { kind: "subscribe"; id: number; event: string }
  | { kind: "unsubscribe"; id: number; event: string }
  | { kind: "reply"; id: number; ok: true; result: unknown }
  | { kind: "reply"; id: number; ok: false; error: PluginApiErrorData };

/**
 * `result` settles a call, subscribe, or unsubscribe. A streaming call's
 * `result` is followed by its `chunk`s and one `end` with the same id.
 * `request` is the host asking the Plugin something (health checks, Command
 * runs), answered with a `reply`.
 */
export type HostToPluginMessage =
  | { kind: "result"; id: number; ok: true; result: unknown }
  | { kind: "result"; id: number; ok: false; error: PluginApiErrorData }
  | { kind: "chunk"; id: number; chunk: unknown }
  | { kind: "end"; id: number; error?: PluginApiErrorData }
  | { kind: "event"; event: string; payload: unknown }
  | { kind: "request"; id: number; method: string; params: unknown }
  | { kind: "stopped"; reason: string };

/** The subset of `MessagePort` both ends use. */
export interface PluginMessagePort {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent) => void) | null;
}

/** Requests sent and not yet answered, by id. */
export type PendingReplies = Map<
  number,
  { resolve: (value: unknown) => void; reject: (error: unknown) => void }
>;

/** Receives a streaming call's body after the call resolves. */
export interface PluginStreamListener<Chunk> {
  onChunk(chunk: Chunk): void;
  /** Called once when the body ends; `error` is set when it ended early. */
  onEnd?(error?: PluginApiError): void;
}

/** A refused or failed Plugin API call. The Plugin keeps running. */
export class PluginApiError extends Error {
  readonly code: PluginApiErrorCode;
  readonly permission?: string;
  readonly method?: string;

  constructor(data: PluginApiErrorData) {
    super(data.message);
    this.name = "PluginApiError";
    this.code = data.code;
    this.permission = data.permission;
    this.method = data.method;
  }
}

/** UTF-8 byte length without allocating, so a size check costs no copy. */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}
