import {
  encrypt,
  decrypt,
  computeChecksum,
  SyncCryptoError,
  uint8ArrayToBase64,
  base64ToUint8Array,
} from "@/features/sync/crypto";
import {
  stringifySnapshot,
  parseJsonValue,
  normalizeNoteSnapshotJson,
  normalizeBookSnapshotJson,
  dumpHasDataSql,
  toOwnedBuffer,
} from "@/features/sync/sync-codec-handlers";
import type { CodecRequest, CodecResponse } from "@/features/sync/sync-codec-types";

function respond(message: CodecResponse, transfer?: Transferable[]): void {
  self.postMessage(message, transfer ? { transfer } : undefined);
}

function fail(id: number, error: unknown): void {
  if (error instanceof SyncCryptoError) {
    respond({ id, ok: false, code: error.code, name: error.name, message: error.message });
    return;
  }
  const name = error instanceof Error ? error.name : "Error";
  const message = error instanceof Error ? error.message : String(error);
  respond({ id, ok: false, name, message });
}

async function handle(msg: CodecRequest): Promise<void> {
  const { id, op } = msg;
  switch (op) {
    case "stringify": {
      respond({ id, ok: true, json: stringifySnapshot(msg.value) });
      return;
    }
    case "parse": {
      respond({ id, ok: true, value: parseJsonValue(msg.text) });
      return;
    }
    case "normalizeNote": {
      respond({ id, ok: true, json: normalizeNoteSnapshotJson(msg.json) });
      return;
    }
    case "normalizeBook": {
      respond({ id, ok: true, json: normalizeBookSnapshotJson(msg.json) });
      return;
    }
    case "encrypt": {
      const encrypted = await encrypt(msg.plaintext, msg.passphrase);
      const buffer = toOwnedBuffer(encrypted);
      respond({ id, ok: true, buffer }, [buffer]);
      return;
    }
    case "decrypt": {
      const text = await decrypt(new Uint8Array(msg.buffer), msg.passphrase);
      respond({ id, ok: true, text });
      return;
    }
    case "encryptToBase64": {
      const encrypted = await encrypt(msg.plaintext, msg.passphrase);
      respond({ id, ok: true, base64: uint8ArrayToBase64(encrypted) });
      return;
    }
    case "decryptBase64": {
      const text = await decrypt(base64ToUint8Array(msg.base64), msg.passphrase);
      respond({ id, ok: true, text });
      return;
    }
    case "checksum": {
      respond({ id, ok: true, checksum: await computeChecksum(msg.text) });
      return;
    }
    case "dumpHasData": {
      const sql = new TextDecoder().decode(new Uint8Array(msg.buffer));
      respond({ id, ok: true, hasData: dumpHasDataSql(sql) });
      return;
    }
  }
}

self.onmessage = (event: MessageEvent<CodecRequest>) => {
  const msg = event.data;
  handle(msg).catch((error: unknown) => fail(msg.id, error));
};
