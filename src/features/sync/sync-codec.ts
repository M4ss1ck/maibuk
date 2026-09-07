import { SyncCryptoError, encrypt, decrypt, computeChecksum } from "@/features/sync/crypto";
import {
  stringifySnapshot,
  parseJsonValue,
  normalizeNoteSnapshotJson,
  dumpHasDataSql,
  toOwnedBuffer,
  uint8ArrayToBase64,
  base64ToUint8Array,
} from "@/features/sync/sync-codec-handlers";
import type { CodecRequest, CodecResponse } from "@/features/sync/sync-codec-types";

// Offloads sync CPU work (JSON encode/decode, note normalization, AES-GCM
// encrypt/decrypt, SHA-256 checksums, base64 loops, SQL dump scanning) to a
// module Worker. Crypto delegates to the unchanged crypto.ts primitives, so
// KDF iteration count, salt/IV layout, and SyncCryptoError codes are exactly
// the ones callers already handle. Database and network I/O stay on the
// caller — only synchronous serialization/encoding runs off-thread.

type SuccessResponse = Extract<CodecResponse, { ok: true }>;
type FailureResponse = Extract<CodecResponse, { ok: false }>;
// Omit over a union collapses to shared keys only — distribute first.
type DistributeOmit<T> = T extends unknown ? Omit<T, "id"> : never;

interface PendingEntry {
  resolve: (response: SuccessResponse) => void;
  reject: (error: Error) => void;
}

let workerInstance: Worker | null = null;
let createWorkerFn: (() => Worker) | null = null;
let nextId = 0;
const pending = new Map<number, PendingEntry>();

export function configureSyncCodecForTests(createWorker: (() => Worker) | null): void {
  failAllPending(new Error("Sync codec reconfigured"));
  createWorkerFn = createWorker;
}

export function resetSyncCodecForTests(): void {
  failAllPending(new Error("Sync codec reset"));
  createWorkerFn = null;
  nextId = 0;
}

function defaultCreateWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  return new Worker(new URL("./sync-codec.worker.ts", import.meta.url), {
    type: "module",
  });
}

function failAllPending(reason: Error): void {
  if (pending.size > 0) {
    const entries = [...pending.values()];
    pending.clear();
    for (const entry of entries) entry.reject(reason);
  }
  if (workerInstance) {
    try {
      workerInstance.terminate();
    } catch {
      // Terminating a broken worker must not mask the original failure.
    }
    workerInstance = null;
  }
}

function toError(failure: FailureResponse): Error {
  if (failure.code) {
    return new SyncCryptoError(failure.code, failure.message);
  }
  if (failure.name === "SyntaxError") {
    return new SyntaxError(failure.message);
  }
  const error = new Error(failure.message);
  error.name = failure.name;
  return error;
}

function handleMessage(data: CodecResponse): void {
  const entry = pending.get(data.id);
  if (!entry) return;
  pending.delete(data.id);
  if (data.ok) {
    entry.resolve(data);
  } else {
    entry.reject(toError(data));
  }
}

function handleWorkerFailure(event: unknown): void {
  const message =
    event instanceof ErrorEvent && event.message
      ? event.message
      : "Sync codec worker failed";
  failAllPending(new Error(message));
}

function ensureWorker(): Worker | null {
  if (workerInstance) return workerInstance;
  const worker = (createWorkerFn ?? defaultCreateWorker)();
  if (!worker) return null;
  worker.onmessage = (event: MessageEvent<CodecResponse>) => handleMessage(event.data);
  worker.onerror = (event) => handleWorkerFailure(event);
  worker.onmessageerror = (event) => handleWorkerFailure(event);
  workerInstance = worker;
  return worker;
}

type FallbackRequest = CodecRequest;

async function runFallback(request: FallbackRequest): Promise<SuccessResponse> {
  const { id } = request;
  switch (request.op) {
    case "stringify":
      return { id, ok: true, json: stringifySnapshot(request.value) };
    case "parse":
      return { id, ok: true, value: parseJsonValue(request.text) };
    case "normalizeNote":
      return { id, ok: true, json: normalizeNoteSnapshotJson(request.json) };
    case "encrypt":
      return {
        id,
        ok: true,
        buffer: toOwnedBuffer(await encrypt(request.plaintext, request.passphrase)),
      };
    case "decrypt":
      return {
        id,
        ok: true,
        text: await decrypt(new Uint8Array(request.buffer), request.passphrase),
      };
    case "encryptToBase64":
      return {
        id,
        ok: true,
        base64: uint8ArrayToBase64(await encrypt(request.plaintext, request.passphrase)),
      };
    case "decryptBase64":
      return {
        id,
        ok: true,
        text: await decrypt(base64ToUint8Array(request.base64), request.passphrase),
      };
    case "checksum":
      return { id, ok: true, checksum: await computeChecksum(request.text) };
    case "dumpHasData":
      return {
        id,
        ok: true,
        hasData: dumpHasDataSql(new TextDecoder().decode(new Uint8Array(request.buffer))),
      };
  }
}

async function dispatch(
  init: DistributeOmit<CodecRequest>,
  transfer?: Transferable[]
): Promise<SuccessResponse> {
  const id = ++nextId;
  const request = { ...init, id } as CodecRequest;
  const worker = ensureWorker();
  // Pure fallback runs only when no Worker constructor exists (tests,
  // non-browser runtimes). A runtime worker failure rejects via failAllPending
  // and resets the instance so the next request retries with a fresh worker.
  if (!worker) return runFallback(request);
  return new Promise<SuccessResponse>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try {
      if (transfer && transfer.length > 0) {
        worker.postMessage(request, { transfer });
      } else {
        worker.postMessage(request);
      }
    } catch (error) {
      failAllPending(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function requiredText(response: SuccessResponse, op: string): string {
  if (response.text === undefined) {
    throw new Error(`Sync codec worker returned no text for ${op}`);
  }
  return response.text;
}

function requiredJson(response: SuccessResponse, op: string): string {
  if (response.json === undefined) {
    throw new Error(`Sync codec worker returned no JSON for ${op}`);
  }
  return response.json;
}

function requiredBuffer(response: SuccessResponse, op: string): ArrayBuffer {
  if (!(response.buffer instanceof ArrayBuffer)) {
    throw new Error(`Sync codec worker returned no binary payload for ${op}`);
  }
  return response.buffer;
}

export async function stringifySnapshotAsync(value: unknown): Promise<string> {
  return requiredJson(await dispatch({ op: "stringify", value }), "stringify");
}

export async function parseJsonAsync<T>(text: string): Promise<T> {
  const response = await dispatch({ op: "parse", text });
  return response.value as T;
}

export async function normalizeNoteSnapshotAsync(json: string): Promise<string> {
  return requiredJson(await dispatch({ op: "normalizeNote", json }), "normalizeNote");
}

// Returns a freshly owned transferable buffer — wrap it directly in a Blob,
// no extra copy.
export async function encryptToBuffer(
  plaintext: string,
  passphrase: string
): Promise<ArrayBuffer> {
  return requiredBuffer(await dispatch({ op: "encrypt", plaintext, passphrase }), "encrypt");
}

export async function decryptBufferToText(
  data: Uint8Array,
  passphrase: string
): Promise<string> {
  // Copy before transferring so the caller's view is never detached.
  const buffer = toOwnedBuffer(data);
  const response = await dispatch({ op: "decrypt", buffer, passphrase }, [buffer]);
  return requiredText(response, "decrypt");
}

export async function encryptToBase64Async(
  plaintext: string,
  passphrase: string
): Promise<string> {
  const response = await dispatch({ op: "encryptToBase64", plaintext, passphrase });
  if (response.base64 === undefined) {
    throw new Error("Sync codec worker returned no base64 payload for encryptToBase64");
  }
  return response.base64;
}

export async function decryptBase64ToText(
  base64: string,
  passphrase: string
): Promise<string> {
  return requiredText(
    await dispatch({ op: "decryptBase64", base64, passphrase }),
    "decryptBase64"
  );
}

export async function computeChecksumAsync(text: string): Promise<string> {
  const response = await dispatch({ op: "checksum", text });
  if (response.checksum === undefined) {
    throw new Error("Sync codec worker returned no checksum");
  }
  return response.checksum;
}

export async function dumpHasDataAsync(sql: Uint8Array): Promise<boolean> {
  const buffer = toOwnedBuffer(sql);
  const response = await dispatch({ op: "dumpHasData", buffer }, [buffer]);
  return response.hasData === true;
}
