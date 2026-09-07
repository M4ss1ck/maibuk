import { afterEach, describe, expect, it } from "vitest";
import {
  SyncCryptoError,
  computeChecksum,
  decrypt,
  encrypt,
  isSyncCryptoError,
  uint8ArrayToBase64,
} from "@/features/sync/crypto";
import {
  base64ToUint8Array,
  dumpHasDataSql,
  normalizeNoteSnapshotJson,
  parseJsonValue,
  stringifySnapshot,
  toOwnedBuffer,
} from "@/features/sync/sync-codec-handlers";
import type { CodecRequest, CodecResponse } from "@/features/sync/sync-codec-types";
import {
  computeChecksumAsync,
  configureSyncCodecForTests,
  decryptBase64ToText,
  decryptBufferToText,
  dumpHasDataAsync,
  encryptToBase64Async,
  encryptToBuffer,
  normalizeNoteSnapshotAsync,
  parseJsonAsync,
  resetSyncCodecForTests,
  stringifySnapshotAsync,
} from "@/features/sync/sync-codec";
import { normalizeNoteSnapshotForSync } from "@/features/sync/serializer";

// Fake worker mirroring sync-codec.worker.ts dispatch logic, but running on
// the main thread against the unchanged crypto.ts primitives — so roundtrips
// and error codes stay genuine while the service's message plumbing,
// transfer handling, and failure recovery are exercised for real.
class FakeWorker {
  onmessage: ((event: { data: CodecResponse }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessageerror: ((event: unknown) => void) | null = null;
  terminated = false;
  transfers: Transferable[][] = [];
  throwOnPost = false;

  postMessage(message: CodecRequest, options?: { transfer: Transferable[] }): void {
    if (this.throwOnPost) throw new Error("postMessage failed");
    if (this.terminated) throw new Error("postMessage on terminated worker");
    this.transfers.push(options?.transfer ?? []);
    queueMicrotask(() => void this.respond(message));
  }

  terminate(): void {
    this.terminated = true;
  }

  private async respond(msg: CodecRequest): Promise<void> {
    const { id } = msg;
    try {
      switch (msg.op) {
        case "stringify":
          this.emit({ id, ok: true, json: stringifySnapshot(msg.value) });
          return;
        case "parse":
          this.emit({ id, ok: true, value: parseJsonValue(msg.text) });
          return;
        case "normalizeNote":
          this.emit({ id, ok: true, json: normalizeNoteSnapshotJson(msg.json) });
          return;
        case "encrypt": {
          const buffer = toOwnedBuffer(await encrypt(msg.plaintext, msg.passphrase));
          this.emit({ id, ok: true, buffer });
          return;
        }
        case "decrypt":
          this.emit({
            id,
            ok: true,
            text: await decrypt(new Uint8Array(msg.buffer), msg.passphrase),
          });
          return;
        case "encryptToBase64": {
          this.emit({
            id,
            ok: true,
            base64: uint8ArrayToBase64(await encrypt(msg.plaintext, msg.passphrase)),
          });
          return;
        }
        case "decryptBase64":
          this.emit({
            id,
            ok: true,
            text: await decrypt(base64ToUint8Array(msg.base64), msg.passphrase),
          });
          return;
        case "checksum":
          this.emit({ id, ok: true, checksum: await computeChecksum(msg.text) });
          return;
        case "dumpHasData":
          this.emit({
            id,
            ok: true,
            hasData: dumpHasDataSql(new TextDecoder().decode(new Uint8Array(msg.buffer))),
          });
          return;
      }
    } catch (error) {
      if (error instanceof SyncCryptoError) {
        this.emit({ id, ok: false, code: error.code, name: error.name, message: error.message });
      } else {
        const name = error instanceof Error ? error.name : "Error";
        const message = error instanceof Error ? error.message : String(error);
        this.emit({ id, ok: false, name, message });
      }
    }
  }

  private emit(response: CodecResponse): void {
    this.onmessage?.({ data: response });
  }
}

const created: FakeWorker[] = [];

function useFakeWorker(): void {
  created.length = 0;
  configureSyncCodecForTests(() => {
    const worker = new FakeWorker();
    created.push(worker);
    return worker as unknown as Worker;
  });
}

afterEach(() => {
  resetSyncCodecForTests();
});

describe("sync codec service dispatch", () => {
  it("round-trips stringify/parse through the worker", async () => {
    useFakeWorker();
    const value = { book: { id: "b1" }, chapters: [] };
    expect(await parseJsonAsync(await stringifySnapshotAsync(value))).toEqual(value);
  });

  it("round-trips encrypt/decrypt in both directions", async () => {
    useFakeWorker();
    const passphrase = "codec-passphrase";

    const buffer = await encryptToBuffer("snapshot json", passphrase);
    expect(buffer).toBeInstanceOf(ArrayBuffer);
    expect(await decryptBufferToText(new Uint8Array(buffer), passphrase)).toBe("snapshot json");

    // Service decrypts blobs produced by crypto.ts directly, and vice versa.
    const direct = await encrypt("direct json", passphrase);
    expect(await decryptBufferToText(direct, passphrase)).toBe("direct json");
    expect(await decrypt(new Uint8Array(await encryptToBuffer("codec json", passphrase)), passphrase)).toBe(
      "codec json"
    );
  });

  it("round-trips base64 encrypt/decrypt", async () => {
    useFakeWorker();
    const passphrase = "codec-passphrase";
    const base64 = await encryptToBase64Async("payload", passphrase);
    expect(await decryptBase64ToText(base64, passphrase)).toBe("payload");
  });

  it("matches crypto checksum and note normalization semantics", async () => {
    useFakeWorker();
    expect(await computeChecksumAsync("abc")).toBe(await computeChecksum("abc"));
    const json = JSON.stringify({
      note: {
        id: "n1",
        title: "t",
        content: "c",
        tags: null,
        pinned: false,
        order: 0,
        wordCount: 1,
        collapsedHeadings: "[]",
        createdAt: 1,
        updatedAt: 2,
        contentUpdatedAt: 2,
      },
    });
    expect(await normalizeNoteSnapshotAsync(json)).toBe(normalizeNoteSnapshotForSync(json));
  });

  it("detects SQL dump data", async () => {
    useFakeWorker();
    expect(
      await dumpHasDataAsync(
        new TextEncoder().encode('INSERT INTO "books" ("id") VALUES (\'a\');')
      )
    ).toBe(true);
    expect(await dumpHasDataAsync(new TextEncoder().encode("-- empty export\n"))).toBe(false);
  });

  it("never detaches the caller's buffer on decrypt", async () => {
    useFakeWorker();
    const passphrase = "codec-passphrase";
    const owned = new Uint8Array(await encryptToBuffer("x", passphrase));
    const before = owned.buffer.byteLength;
    await decryptBufferToText(owned, passphrase);
    expect(owned.buffer.byteLength).toBe(before);
  });

  it("transfers the decrypt input instead of cloning it", async () => {
    useFakeWorker();
    const passphrase = "codec-passphrase";
    const owned = new Uint8Array(await encryptToBuffer("x", passphrase));
    await decryptBufferToText(owned, passphrase);
    const decryptCall = created[0].transfers;
    expect(decryptCall.some((list) => list.length > 0)).toBe(true);
  });

  it("transfers a copy of the dump bytes without detaching the caller's buffer", async () => {
    useFakeWorker();
    const sql = new TextEncoder().encode('INSERT INTO "books" ("id") VALUES (\'a\');');
    const before = sql.buffer.byteLength;
    expect(await dumpHasDataAsync(sql)).toBe(true);
    expect(sql.buffer.byteLength).toBe(before);
    expect(created[0].transfers.some((list) => list.length > 0)).toBe(true);
  });
});

describe("sync codec error preservation", () => {
  it("preserves SyncCryptoError code for a wrong passphrase", async () => {
    useFakeWorker();
    const buffer = await encryptToBuffer("secret", "right");
    await expect(decryptBufferToText(new Uint8Array(buffer), "wrong")).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof SyncCryptoError && error.code === "INVALID_PASSPHRASE"
    );
  });

  it("preserves INVALID_PAYLOAD for truncated ciphertext", async () => {
    useFakeWorker();
    await expect(decryptBufferToText(new Uint8Array([1, 2, 3]), "passphrase")).rejects.toSatisfy(
      (error: unknown) => isSyncCryptoError(error) && error.code === "INVALID_PAYLOAD"
    );
  });

  it("surfaces invalid JSON as SyntaxError so callsites keep their wording", async () => {
    useFakeWorker();
    await expect(parseJsonAsync("{nope")).rejects.toBeInstanceOf(SyntaxError);
  });
});

describe("sync codec failure recovery", () => {
  it("rejects pending jobs and retries with a fresh worker after onerror", async () => {
    useFakeWorker();
    const pendingCall = stringifySnapshotAsync({ a: 1 });
    created[0].onerror?.(new ErrorEvent("error", { message: "boom" }));
    await expect(pendingCall).rejects.toThrow("boom");

    expect(await stringifySnapshotAsync({ b: 2 })).toBe(JSON.stringify({ b: 2 }));
    expect(created.length).toBe(2);
    expect(created[0].terminated).toBe(true);
  });

  it("rejects pending jobs and retries after a postMessage failure", async () => {
    created.length = 0;
    let failNextPost = true;
    configureSyncCodecForTests(() => {
      const worker = new FakeWorker();
      if (failNextPost) {
        failNextPost = false;
        worker.throwOnPost = true;
      }
      created.push(worker);
      return worker as unknown as Worker;
    });
    await expect(stringifySnapshotAsync({ a: 1 })).rejects.toThrow("postMessage failed");
    expect(await stringifySnapshotAsync({ b: 2 })).toBe(JSON.stringify({ b: 2 }));
    expect(created.length).toBe(2);
  });
});

describe("sync codec fallback without Worker", () => {
  const workerSupported = typeof Worker !== "undefined";

  it.runIf(!workerSupported)("runs pure handlers for stringify and crypto", async () => {
    configureSyncCodecForTests(null);
    const value = { note: { id: "n1" } };
    expect(await parseJsonAsync(await stringifySnapshotAsync(value))).toEqual(value);

    const buffer = await encryptToBuffer("fallback secret", "passphrase");
    expect(await decryptBufferToText(new Uint8Array(buffer), "passphrase")).toBe(
      "fallback secret"
    );
    await expect(decryptBufferToText(new Uint8Array(buffer), "wrong")).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof SyncCryptoError && error.code === "INVALID_PASSPHRASE"
    );
    expect(
      await dumpHasDataAsync(new TextEncoder().encode("INSERT INTO notes VALUES (1);"))
    ).toBe(true);
  });
});
