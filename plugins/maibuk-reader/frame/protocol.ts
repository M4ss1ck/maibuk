/**
 * The Reader Frame's protocol client (#941): the messages the Plugin Worker and
 * the reading Frame exchange over `window.maibuk.port`, and the Frame side that
 * sends requests and settles their answers with the handlers `entry.ts`
 * assigns.
 *
 * The wire shapes are the Frame's own copy of `../frame-protocol.ts`. The Frame
 * cannot import the Worker's file (see `entry.ts`), so the shapes stay
 * duplicated and a change lands on both sides at once.
 */

import type {
  FrameEntry,
  FrameFoliate,
  FrameLabels,
  FramePdf,
  FrameZipEntry,
  ReaderSettings,
  ReadingPosition,
} from "./types";

/** Opens one Document. `pdfPort` is transferred alongside the message. */
export interface FrameOpenMessage {
  kind: "open";
  entry: FrameEntry | null;
  position: ReadingPosition | null;
  settings: ReaderSettings;
  size: number;
  labels: FrameLabels;
  language: string;
  pdf?: FramePdf;
  pdfPort?: MessagePort;
  foliate?: FrameFoliate;
}

/** Answers one `read`. */
export interface FrameBytesMessage {
  kind: "bytes";
  id: number;
  buffer: ArrayBuffer;
}

/** Refuses one `read`. */
export interface FrameReadErrorMessage {
  kind: "read-error";
  id: number;
  code: string;
}

/** Forwards one reading Command to the mounted Frame. */
export interface FrameCommandMessage {
  kind: "command";
  id: string;
}

/** Tells the Frame the app language changed. */
export interface FrameLanguageMessage {
  kind: "language";
  language: string;
  labels?: FrameLabels;
}

/** Lists every entry of the archive the Document is packed in. */
export interface FrameZipListMessage {
  kind: "zip-list";
  id: number;
  entries: FrameZipEntry[];
}

/** Answers one `zip-entry`. */
export interface FrameZipDataMessage {
  kind: "zip-data";
  id: number;
  buffer: ArrayBuffer;
  deflated: boolean;
}

/** Refuses one archive request. */
export interface FrameZipErrorMessage {
  kind: "zip-error";
  id: number;
  code: "corrupt" | "drm" | "missing";
}

export type WorkerToFrameMessage =
  | FrameOpenMessage
  | FrameBytesMessage
  | FrameReadErrorMessage
  | FrameCommandMessage
  | FrameLanguageMessage
  | FrameZipListMessage
  | FrameZipDataMessage
  | FrameZipErrorMessage;

/** An error that carries the protocol's failure `code`. */
export interface CodedError extends Error {
  code: string;
}

/**
 * The string `code` an error carries, or "" when it carries none. The Worker's
 * refusals, the archive's refusals, and the Frame's own Document failures all
 * read this way, so one check serves every failure path.
 */
export function errorCode(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  const carried = (error as { code?: unknown }).code;
  return typeof carried === "string" ? carried : "";
}

/** The error a refused request rejects with. */
function codedError(message: string, code: string): CodedError {
  return Object.assign(new Error(message), { code });
}

/** One in-flight request: the promise's own settle functions. */
interface Pending<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

/** One archive entry as the Worker stored it. */
export interface FrameZipEntryData {
  buffer: ArrayBuffer;
  deflated: boolean;
}

/** One archive answer: the entry list, or one entry's bytes. */
type FrameZipAnswer = { entries: FrameZipEntry[] } | FrameZipEntryData;

/** The client `entry.ts` composes its wiring over. */
export interface FrameProtocol {
  /** Sends one message to the Worker; nothing is sent once {@link close} ran. */
  post(message: unknown, transfer?: Transferable[]): void;
  /** Reads `length` bytes at `offset`, and none at all at or below zero. */
  requestBytes(offset: number, length: number): Promise<Uint8Array>;
  /** Lists the archive the Document is packed in. */
  requestZipList(): Promise<{ entries: FrameZipEntry[] }>;
  /** Reads one archive entry as the Worker stored it. */
  requestZipEntry(name: string): Promise<FrameZipEntryData>;
  /** Rejects every byte read still in flight with `reason`. */
  abortReads(reason: string): void;
  /** Rejects every archive request still in flight with `reason`. */
  abortArchive(reason: string): void;
  /** Settles whichever request one port message answers, or calls a handler. */
  receive(data: unknown): void;
  /** Stops posting to the Worker; called when the Frame is cleaned up. */
  close(): void;
  /** Handles `open`; `entry.ts` assigns `handleOpen`. */
  onOpen?: (message: FrameOpenMessage) => void;
  /** Handles `command`; `entry.ts` assigns `runCommand`. */
  onCommand?: (id: string) => void;
  /** Handles `language`; `entry.ts` re-labels its chrome. */
  onLanguage?: (language: string, labels: FrameLabels | null) => void;
}

/** Whether one port message names a message the Frame handles. */
function isWorkerToFrameMessage(data: unknown): data is WorkerToFrameMessage {
  if (typeof data !== "object" || data === null) return false;
  return typeof (data as { kind?: unknown }).kind === "string";
}

/**
 * The protocol client over `port`. One Frame makes one client; it closes over
 * the in-flight reads and archive requests so a settling message finds them,
 * and posts nothing once {@link FrameProtocol.close} ran.
 */
export function createFrameProtocol(port: MessagePort | null | undefined): FrameProtocol {
  const pendingReads = new Map<number, Pending<Uint8Array>>();
  /** The id space is shared by the list and entry requests (see `waitForZip`). */
  const pendingZip = new Map<number, Pending<unknown>>();
  let nextReadId = 1;
  let nextZipId = 1;
  let closed = false;

  function post(message: unknown, transfer?: Transferable[]): void {
    if (closed || !port) return;
    if (transfer === undefined) port.postMessage(message);
    else port.postMessage(message, transfer);
  }

  /** Registers one archive request, narrowing its answer to what that call asked for. */
  function waitForZip<T>(
    id: number,
    resolve: (value: T) => void,
    reject: (error: Error) => void
  ): void {
    pendingZip.set(id, {
      // Each id receives only the answer its own request asked for, so the
      // shared map's value narrows back to `T` at the request that made it.
      resolve: (value) => resolve(value as T),
      reject,
    });
  }

  function settleZip(id: number, value: FrameZipAnswer): void {
    const pending = pendingZip.get(id);
    if (!pending) return;
    pendingZip.delete(id);
    pending.resolve(value);
  }

  function rejectZip(id: number, code: string): void {
    const pending = pendingZip.get(id);
    if (!pending) return;
    pendingZip.delete(id);
    pending.reject(codedError(`Reader could not read this archive (${code})`, code));
  }

  function settleRead(id: number, buffer: ArrayBuffer): void {
    const pending = pendingReads.get(id);
    if (!pending) return;
    pendingReads.delete(id);
    pending.resolve(new Uint8Array(buffer));
  }

  function rejectRead(id: number, code: string): void {
    const pending = pendingReads.get(id);
    if (!pending) return;
    pendingReads.delete(id);
    pending.reject(codedError(`Reader could not read this file (${code})`, code));
  }

  function requestBytes(offset: number, length: number): Promise<Uint8Array> {
    if (length <= 0) return Promise.resolve(new Uint8Array(0));
    const id = nextReadId++;
    return new Promise((resolve, reject) => {
      pendingReads.set(id, { resolve, reject });
      post({ kind: "read", id, offset, length });
    });
  }

  function requestZipList(): Promise<{ entries: FrameZipEntry[] }> {
    const id = nextZipId++;
    return new Promise((resolve, reject) => {
      waitForZip(id, resolve, reject);
      post({ kind: "zip-list", id });
    });
  }

  function requestZipEntry(name: string): Promise<FrameZipEntryData> {
    const id = nextZipId++;
    return new Promise((resolve, reject) => {
      waitForZip(id, resolve, reject);
      post({ kind: "zip-entry", id, name });
    });
  }

  function abortReads(reason: string): void {
    for (const pending of pendingReads.values()) {
      pending.reject(new Error(reason));
    }
    pendingReads.clear();
  }

  function abortArchive(reason: string): void {
    for (const pending of pendingZip.values()) {
      pending.reject(new Error(reason));
    }
    pendingZip.clear();
  }

  function receive(data: unknown): void {
    if (!isWorkerToFrameMessage(data)) return;
    switch (data.kind) {
      case "open":
        void client.onOpen?.(data);
        return;
      case "bytes":
        settleRead(data.id, data.buffer);
        return;
      case "read-error":
        rejectRead(data.id, data.code);
        return;
      case "command":
        client.onCommand?.(data.id);
        return;
      case "language":
        if (typeof data.language === "string") {
          client.onLanguage?.(data.language, data.labels ?? null);
        }
        return;
      case "zip-list":
        settleZip(data.id, { entries: data.entries });
        return;
      case "zip-data":
        settleZip(data.id, { buffer: data.buffer, deflated: data.deflated === true });
        return;
      case "zip-error":
        rejectZip(data.id, data.code);
        return;
      default:
        return;
    }
  }

  const client: FrameProtocol = {
    post,
    requestBytes,
    requestZipList,
    requestZipEntry,
    abortReads,
    abortArchive,
    receive,
    close() {
      closed = true;
    },
  };
  return client;
}
