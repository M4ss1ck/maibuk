const PBKDF2_ITERATIONS = 600_000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const GCM_TAG_LENGTH = 16;

let sessionPassphrase: string | null = null;

export type SyncCryptoErrorCode =
  | "MISSING_PASSPHRASE"
  | "INVALID_PAYLOAD"
  | "INVALID_PASSPHRASE";

export class SyncCryptoError extends Error {
  readonly code: SyncCryptoErrorCode;

  constructor(code: SyncCryptoErrorCode, message: string) {
    super(message);
    this.name = "SyncCryptoError";
    this.code = code;
  }
}

export function isSyncCryptoError(error: unknown): error is SyncCryptoError {
  return error instanceof SyncCryptoError;
}

function assertPassphrase(passphrase: string): void {
  if (!passphrase) {
    throw new SyncCryptoError(
      "MISSING_PASSPHRASE",
      "Passphrase is required for sync encryption",
    );
  }
}

export function setPassphrase(passphrase: string): void {
  sessionPassphrase = passphrase;
}

export function getPassphrase(): string | null {
  return sessionPassphrase;
}

export function clearPassphrase(): void {
  sessionPassphrase = null;
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const normalizedSalt = new Uint8Array(salt);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: normalizedSalt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encrypt(
  plaintext: string,
  passphrase: string,
): Promise<Uint8Array> {
  assertPassphrase(passphrase);

  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(passphrase, salt);

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(plaintext),
  );

  // Format: [salt (16B)][iv (12B)][ciphertext]
  const result = new Uint8Array(
    SALT_LENGTH + IV_LENGTH + ciphertext.byteLength,
  );
  result.set(salt, 0);
  result.set(iv, SALT_LENGTH);
  result.set(new Uint8Array(ciphertext), SALT_LENGTH + IV_LENGTH);

  return result;
}

export async function decrypt(
  blob: Uint8Array,
  passphrase: string,
): Promise<string> {
  assertPassphrase(passphrase);

  const minPayloadLength = SALT_LENGTH + IV_LENGTH + GCM_TAG_LENGTH;
  if (blob.length < minPayloadLength) {
    throw new SyncCryptoError(
      "INVALID_PAYLOAD",
      "Encrypted payload is invalid or corrupted",
    );
  }

  const salt = blob.slice(0, SALT_LENGTH);
  const iv = blob.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const ciphertext = blob.slice(SALT_LENGTH + IV_LENGTH);
  const key = await deriveKey(passphrase, salt);

  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext,
    );

    return new TextDecoder().decode(decrypted);
  } catch {
    throw new SyncCryptoError(
      "INVALID_PASSPHRASE",
      "Invalid passphrase or corrupted synced data",
    );
  }
}

export async function computeChecksum(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(data),
  );
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
