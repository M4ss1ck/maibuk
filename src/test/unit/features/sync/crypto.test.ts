import { beforeEach, describe, expect, it } from "vitest";

import {
  clearPassphrase,
  computeChecksum,
  decrypt,
  decryptMeta,
  encrypt,
  encryptMeta,
  getPassphrase,
  isSyncCryptoError,
  setPassphrase,
  uint8ArrayToBase64,
} from "../../../../features/sync/crypto";

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

  it("returns a different payload every time because salt and IV are random", async () => {
    const plaintext = "same text";
    const passphrase = "same-passphrase";

    const encryptedA = await encrypt(plaintext, passphrase);
    const encryptedB = await encrypt(plaintext, passphrase);

    expect(encryptedA).not.toEqual(encryptedB);
  });

  it("throws MISSING_PASSPHRASE when encrypting with an empty passphrase", async () => {
    await expect(encrypt("data", "")).rejects.toSatisfy((error: unknown) => {
      if (!isSyncCryptoError(error)) {
        return false;
      }

      return error.code === "MISSING_PASSPHRASE";
    });
  });

  it("throws MISSING_PASSPHRASE when decrypting with an empty passphrase", async () => {
    const encrypted = await encrypt("secret", "passphrase-a");

    await expect(decrypt(encrypted, "")).rejects.toSatisfy((error: unknown) => {
      if (!isSyncCryptoError(error)) {
        return false;
      }

      return error.code === "MISSING_PASSPHRASE";
    });
  });

  it("throws INVALID_PAYLOAD for blobs that are too short", async () => {
    const shortBlob = new Uint8Array(3);

    await expect(decrypt(shortBlob, "passphrase")).rejects.toMatchObject({
      code: "INVALID_PAYLOAD",
    });
  });

  it("throws INVALID_PASSPHRASE when decrypting with the wrong passphrase", async () => {
    const encrypted = await encrypt("secret", "passphrase-a");

    await expect(decrypt(encrypted, "passphrase-b")).rejects.toSatisfy((error: unknown) => {
      expect(isSyncCryptoError(error)).toBe(true);
      if (!isSyncCryptoError(error)) {
        return false;
      }
      return error.code === "INVALID_PASSPHRASE";
    });
  });

  it("computes a deterministic sha-256 checksum", async () => {
    const hash = await computeChecksum("hello world");

    expect(hash).toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
    expect(hash).toHaveLength(64);
  });

  it("stores and clears session passphrase", () => {
    setPassphrase("my-passphrase");
    expect(getPassphrase()).toBe("my-passphrase");

    clearPassphrase();
    expect(getPassphrase()).toBeNull();
  });
});

describe("meta envelope", () => {
  beforeEach(() => setPassphrase("test-pass"));

  it("round-trips a metadata object and embeds formatVersion", async () => {
    const meta = await encryptMeta({ name: "Draft 2", wordCount: 1200 });

    expect(typeof meta).toBe("string");
    const decoded = await decryptMeta(meta);
    expect(decoded).toMatchObject({ name: "Draft 2", wordCount: 1200, v: 1 });
  });

  it("returns {} for empty meta", async () => {
    expect(await decryptMeta("")).toEqual({});
  });

  it("throws when no passphrase is set", async () => {
    clearPassphrase();

    await expect(encryptMeta({ a: 1 })).rejects.toMatchObject({ code: "MISSING_PASSPHRASE" });
  });

  it("throws INVALID_PAYLOAD for malformed base64 metadata", async () => {
    await expect(decryptMeta("not valid base64!")).rejects.toMatchObject({
      code: "INVALID_PAYLOAD",
    });
  });

  it("throws INVALID_PAYLOAD for encrypted non-JSON metadata", async () => {
    const encrypted = await encrypt("not json", "test-pass");
    const meta = uint8ArrayToBase64(encrypted);

    await expect(decryptMeta(meta)).rejects.toMatchObject({
      code: "INVALID_PAYLOAD",
    });
  });

  it("throws INVALID_PASSPHRASE for metadata encrypted with a different passphrase", async () => {
    setPassphrase("passphrase-a");
    const meta = await encryptMeta({ name: "Draft 2" });
    setPassphrase("passphrase-b");

    await expect(decryptMeta(meta)).rejects.toMatchObject({
      code: "INVALID_PASSPHRASE",
    });
  });
});
