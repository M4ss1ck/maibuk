import type { SyncCryptoErrorCode } from "@/features/sync/crypto";

// Main thread -> Worker. Binary payloads travel as owned ArrayBuffers so the
// worker receives them via transfer instead of structured-clone copies.
export type CodecRequest =
  | { id: number; op: "stringify"; value: unknown }
  | { id: number; op: "parse"; text: string }
  | { id: number; op: "normalizeNote"; json: string }
  | { id: number; op: "encrypt"; plaintext: string; passphrase: string }
  | { id: number; op: "decrypt"; buffer: ArrayBuffer; passphrase: string }
  | { id: number; op: "encryptToBase64"; plaintext: string; passphrase: string }
  | { id: number; op: "decryptBase64"; base64: string; passphrase: string }
  | { id: number; op: "checksum"; text: string }
  | { id: number; op: "dumpHasData"; sql: string };

// Worker -> Main thread. Successful binary results are transferred back as
// owned ArrayBuffers; failures carry the error name/message (plus the
// SyncCryptoError code when applicable) so the service can reconstruct them.
export type CodecResponse =
  | {
      id: number;
      ok: true;
      text?: string;
      json?: string;
      value?: unknown;
      checksum?: string;
      base64?: string;
      hasData?: boolean;
      buffer?: ArrayBuffer;
    }
  | {
      id: number;
      ok: false;
      code?: SyncCryptoErrorCode;
      name: string;
      message: string;
    };
