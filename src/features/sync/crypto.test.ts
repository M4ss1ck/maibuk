import { describe, expect, it } from "vitest";

import {
  clearPassphrase,
  computeChecksum,
  decrypt,
  encrypt,
  getPassphrase,
  isSyncCryptoError,
  setPassphrase,
} from "./crypto";

describe("sync crypto", () => {
  it("encrypts and decrypts data with the same passphrase", async () => {
    const plaintext = "chapter payload";
    const passphrase = "correct horse battery staple";

    const encrypted = await encrypt(plaintext, passphrase);
    const decrypted = await decrypt(encrypted, passphrase);

    expect(encrypted).toBeInstanceOf(Uint8Array);
    expect(encrypted.length).toBeGreaterThan(0);
    expect(decrypted).toBe(plaintext);
  });

  it("throws INVALID_PAYLOAD for blobs that are too short", async () => {
    const shortBlob = new Uint8Array(3);

    await expect(decrypt(shortBlob, "passphrase")).rejects.toMatchObject({
      code: "INVALID_PAYLOAD",
    });
  });

  it("throws INVALID_PASSPHRASE when decrypting with the wrong passphrase", async () => {
    const encrypted = await encrypt("secret", "passphrase-a");

    await expect(decrypt(encrypted, "passphrase-b")).rejects.toSatisfy(
      (error: unknown) => {
        expect(isSyncCryptoError(error)).toBe(true);
        if (!isSyncCryptoError(error)) {
          return false;
        }
        return error.code === "INVALID_PASSPHRASE";
      },
    );
  });

  it("computes a deterministic sha-256 checksum", async () => {
    const hash = await computeChecksum("hello world");

    expect(hash).toBe(
      "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
    );
  });

  it("stores and clears session passphrase", () => {
    setPassphrase("my-passphrase");
    expect(getPassphrase()).toBe("my-passphrase");

    clearPassphrase();
    expect(getPassphrase()).toBeNull();
  });
});
