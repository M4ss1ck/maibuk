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
