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
  "conflict",
  "not-implemented",
  "message-too-large",
  "network-error",
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

/**
 * Largest streamed body chunk, serialized, in UTF-8 bytes (keeps typing smooth
 * during downloads). A Plugin's Endpoint answer also caps each chunk at this
 * many decoded bytes; its SDK splits a bigger piece.
 */
export const PLUGIN_STREAM_CHUNK_MAX_BYTES = 64 * 1024;

export function messageTooLarge(method?: string): PluginApiErrorData {
  return { code: "message-too-large", message: "Messages to Maibuk are capped at 4 MB", method };
}

export type PluginToHostMessage =
  | { kind: "call"; id: number; method: string; params: unknown }
  | { kind: "subscribe"; id: number; event: string }
  | { kind: "unsubscribe"; id: number; event: string }
  | { kind: "reply"; id: number; ok: true; result: unknown }
  | { kind: "reply"; id: number; ok: false; error: PluginApiErrorData }
  | { kind: "chunk"; id: number; chunk: string }
  | { kind: "end"; id: number };

/**
 * `result` settles a call, subscribe, or unsubscribe. A streaming call's
 * `result` is followed by its `chunk`s and one `end` with the same id.
 * `request` is the host asking the Plugin something (health checks, Command
 * runs, Endpoint requests), answered with a `reply`. A streamed Endpoint
 * answer's `reply` is followed by its `chunk`s, each base64, and one `end`,
 * all keyed by the host request's id — the mirror of the host's own
 * `chunk`/`end` for a streaming call.
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
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent) => void) | null;
}

/**
 * The host request a Plugin answers to migrate its stored data once, before it
 * is ready, when the namespace was written by an older `dataVersion` (ADR
 * 0023). The handler receives `{ from }`, the stored version.
 */
export const PLUGIN_MIGRATE_DATA_REQUEST = "migrateData";

/**
 * The host request a ready Plugin answers to run one of its Commands. `params`
 * is `{ id, target? }`: `id` is the Command's Plugin-local id, `target` the
 * item it was invoked on when the Command declares `targets`. The host
 * captures the target before it sends the request and that captured target is
 * what the Plugin receives; the host re-reads it once more after the reply
 * only to decide whether the outcome is reported as ran or cancelled.
 */
export const PLUGIN_COMMAND_RUN_REQUEST = "command.run";

/**
 * The host request a Plugin answers to mount one Remote UI surface. `params` is
 * `PluginUiMountParams`: `surface` is the host-chosen id of this one mount,
 * `kind` is the registry it renders from (`page`, the default, or
 * `settingsRow`), `page` is the Plugin-local page id — or the Settings row's
 * Plugin-local id when `kind` is `settingsRow` — and `port` is a fresh
 * MessagePort transferred with the request. The Plugin renders that surface
 * over it, and the host closes its own end on unmount.
 */
export const PLUGIN_UI_MOUNT_REQUEST = "ui.mount";

/**
 * Which registry a mount draws from. A page id and a Settings row id share one
 * namespace inside a Plugin, so the kind keeps them apart: `detection` as a
 * page is a different surface from `detection` as a Settings row.
 */
export type PluginUiMountKind = "page" | "settingsRow";

export interface PluginUiMountParams {
  surface: string;
  /** The registry to render from; omitted means `page`. */
  kind?: PluginUiMountKind;
  /** A page id, or a Settings row's Plugin-local id when `kind` is `settingsRow`. */
  page: string;
  port: MessagePort;
}

/**
 * The host request a Plugin answers to tear one mount down. `params` is
 * `PluginUiUnmountParams`: `surface` is the id the host chose for the mount it
 * wants the Plugin to release.
 */
export const PLUGIN_UI_UNMOUNT_REQUEST = "ui.unmount";

export interface PluginUiUnmountParams {
  surface: string;
}

/**
 * The host request a Plugin that holds the `serve` Permission answers: one HTTP
 * request that reached the Plugin Endpoint at `/plugin/<pluginId>/…`. `params`
 * is an {@link EndpointRequest}. The reply's result is an
 * {@link EndpointAnswer}; when it says `streaming`, the `reply` is followed by
 * Plugin to host `chunk`s, each base64, and one `end`, all keyed by the host
 * request's id.
 */
export const PLUGIN_ENDPOINT_REQUEST = "endpoint.request";

/**
 * One inbound Endpoint request, over the wire. `path` is the full request path
 * including the query (`/plugin/acme/mcp?x=1`), `headers` keeps names
 * lower-cased and duplicates in order, and `body` is base64 of the raw request
 * bytes (`""` when there is no body).
 */
export interface EndpointRequest {
  method: string;
  path: string;
  headers: [string, string][];
  /** Base64 of the raw request bytes; `""` when none. */
  body: string;
}

/**
 * The answer to one Endpoint request. `headers` keeps duplicates in order and
 * `body` is base64 of the raw response bytes, omitted when there are none.
 * `streaming` is true when the body follows as `chunk`s and an `end`;
 * otherwise the whole answer is this one message.
 */
export interface EndpointAnswer {
  status: number;
  headers: [string, string][];
  /** Base64 of the raw response bytes; omitted when there are none. */
  body?: string;
  streaming: boolean;
}

/**
 * The sandbox's boot handshake with the Plugin's Worker. `PLUGIN_BOOT_MESSAGE`
 * carries the entry module's `blob:` URL; `PLUGIN_INIT_MESSAGE` carries the
 * Plugin's one MessagePort (`event.ports[0]`). The Worker's fixed prelude
 * consumes both, imports the entry, then replays the init message to the
 * Plugin's handler. The Worker posts `PLUGIN_READY_MESSAGE` back to its frame
 * once setup finished, and the frame forwards it to the host, which then sends
 * the first health check.
 */
export const PLUGIN_BOOT_MESSAGE = { kind: "maibuk:plugin-boot" } as const;
export const PLUGIN_INIT_MESSAGE = { kind: "maibuk:plugin-init" } as const;
export const PLUGIN_READY_MESSAGE = { kind: "maibuk:plugin-ready" } as const;
/** The prelude's report when importing the entry module failed. */
export const PLUGIN_ERROR_MESSAGE = { kind: "maibuk:plugin-error" } as const;

/**
 * The boot message's shape. On every engine it carries `entry`: on the native
 * engines that is the entry module's `blob:` URL; on the Android QuickJS engine
 * (#516) it is the Plugin-relative path that keys {@link PluginBootMessage.sources}.
 *
 * The four Android-only fields are present only when the build selected the
 * QuickJS engine, and are named so the `queueMicrotask` prelude can read them
 * without evaluating any Plugin bytes:
 *
 * - `engine` is `"quickjs"`; omitted means the native `import(entry)` path.
 * - `runner` is the frame-created `blob:` URL of the bundled QuickJS runner
 *   module (`host-assets.ts`), which the prelude imports.
 * - `sources` is the verified Plugin module graph as data, keyed by
 *   Plugin-relative path — never turned into `blob:` URLs on this path.
 * - `wasmBinary` is the raw QuickJS Wasm bytes. They cross the frame as a copied
 *   `ArrayBuffer` and the runner compiles them inside the Worker; a compiled
 *   `WebAssembly.Module` cannot cross the frame (the message is dropped), so the
 *   bytes stay bytes until the Worker has them.
 */
export interface PluginBootMessage {
  kind: typeof PLUGIN_BOOT_MESSAGE.kind;
  /** The entry module's `blob:` URL, or its `sources` key on the QuickJS engine. */
  entry: string;
  /** The engine the prelude must run the module graph in; omitted is the native import. */
  engine?: "quickjs";
  /** The frame-created URL of the bundled QuickJS runner module. */
  runner?: string;
  /** The verified Plugin module sources, keyed by Plugin-relative path. */
  sources?: Record<string, string>;
  /** The raw QuickJS Wasm bytes the Worker compiles before instantiating. */
  wasmBinary?: ArrayBuffer;
}

/** True for the boot message's shape, so the sandbox and a test share one check. */
export function isPluginBootMessage(value: unknown): value is PluginBootMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === PLUGIN_BOOT_MESSAGE.kind &&
    typeof (value as { entry?: unknown }).entry === "string"
  );
}

/**
 * The sandbox's Frame handoff with the Plugin's Worker (#454, D1). The host
 * posts this over the Plugin's own broker MessagePort (`runtime.ts`
 * `sendFrame`) with the Frame's MessagePort transferred, so the Worker's SDK
 * settles it before RPC dispatch and exposes it through `client.onFrame`. The
 * host never parses Frame traffic.
 */
export const PLUGIN_FRAME_MESSAGE = { kind: "maibuk:plugin-frame" } as const;

/**
 * The Frame message's shape: `frameId` is the host's mount id and `src` the
 * Plugin-folder-relative path of the Frame's HTML. Delivered on the Worker's
 * own message channel, with the Frame's port as `event.ports[0]`.
 */
export interface PluginFrameMessage {
  kind: typeof PLUGIN_FRAME_MESSAGE.kind;
  frameId: string;
  src: string;
}

/**
 * One mounted Frame the host hands the Plugin (#454): the port is the Frame's
 * own MessagePort, which the Plugin talks over to relay messages between its
 * Worker and the Frame.
 */
export interface PluginFrame {
  id: string;
  src: string;
  port: MessagePort;
}

/**
 * Why the host activated a Plugin, delivered to the Worker on the init message
 * (#400, #445). The first seven are the manifest decision's; `warmStart` and
 * `restart` come from the performance decision (#401). A raw-wire Plugin reads
 * it from the init event's `data.startReason`; the SDK exposes it as
 * `PluginClient.activation`.
 */
export type PluginStartReason =
  | "enable"
  | "launch"
  | "update"
  | "restore"
  | "resetLibrary"
  | "databaseLoad"
  | "settingsReset"
  | "warmStart"
  | "restart";

/**
 * The init message's shape: `PLUGIN_INIT_MESSAGE` is its kind, and the host
 * fills `startReason`. It stays optional so a test or an older host that omits
 * it still starts a Plugin.
 */
export interface PluginInitMessage {
  kind: typeof PLUGIN_INIT_MESSAGE.kind;
  startReason?: PluginStartReason;
}

/** True for the init message's shape, so the SDK and a raw-wire Plugin share one check. */
export function isPluginInitMessage(value: unknown): value is PluginInitMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === PLUGIN_INIT_MESSAGE.kind
  );
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

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_VALUES: Record<string, number> = {};
for (let i = 0; i < BASE64_ALPHABET.length; i++) BASE64_VALUES[BASE64_ALPHABET[i]] = i;

/**
 * Decodes base64 without `atob`, which not every Plugin engine has (the Android
 * QuickJS engine does not). Throws on anything that is not base64.
 */
export function base64ToBytes(text: string): Uint8Array {
  const length = base64DecodedLength(text);
  if (length < 0) throw new Error("Invalid base64");
  const bytes = new Uint8Array(length);
  let buffer = 0;
  let bits = 0;
  let written = 0;
  for (let i = 0; i < text.length; i++) {
    const value = BASE64_VALUES[text[i]];
    if (value === undefined) break;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[written++] = (buffer >> bits) & 0xff;
    }
  }
  return bytes;
}

/**
 * The byte length base64 `text` decodes to, or -1 when it is not base64 or its
 * length is not a multiple of four. Checks the characters, so a caller can
 * refuse an oversized or malformed payload without allocating its bytes.
 */
export function base64DecodedLength(text: string): number {
  if (text.length === 0) return 0;
  if (text.length % 4 !== 0) return -1;
  let padding = 0;
  if (text.charCodeAt(text.length - 1) === 61) {
    padding = text.charCodeAt(text.length - 2) === 61 ? 2 : 1;
  }
  for (let i = 0; i < text.length - padding; i++) {
    if (BASE64_VALUES[text[i]] === undefined) return -1;
  }
  return (text.length / 4) * 3 - padding;
}

/** Encodes bytes as base64 without `btoa`, for the same reason. */
export function bytesToBase64(bytes: Uint8Array): string {
  let output = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const value = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    output +=
      BASE64_ALPHABET[(value >> 18) & 63] +
      BASE64_ALPHABET[(value >> 12) & 63] +
      BASE64_ALPHABET[(value >> 6) & 63] +
      BASE64_ALPHABET[value & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const value = bytes[i] << 16;
    output += `${BASE64_ALPHABET[(value >> 18) & 63]}${BASE64_ALPHABET[(value >> 12) & 63]}==`;
  } else if (rest === 2) {
    const value = (bytes[i] << 16) | (bytes[i + 1] << 8);
    output += `${BASE64_ALPHABET[(value >> 18) & 63]}${BASE64_ALPHABET[(value >> 12) & 63]}${BASE64_ALPHABET[(value >> 6) & 63]}=`;
  }
  return output;
}
