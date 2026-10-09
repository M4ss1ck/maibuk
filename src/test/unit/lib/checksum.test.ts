// @vitest-environment node
import { describe, expect, it } from "vitest";
import { computeChecksum } from "@/lib/checksum";

// SHA-256 of the ASCII bytes "abc" (FIPS 180-2 test vector).
const ABC_SHA256 = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

describe("computeChecksum", () => {
  it("hashes a string as its UTF-8 bytes", async () => {
    expect(await computeChecksum("abc")).toBe(ABC_SHA256);
  });

  it("hashes bytes", async () => {
    expect(await computeChecksum(new TextEncoder().encode("abc"))).toBe(ABC_SHA256);
  });

  it("hashes bytes that live in a SharedArrayBuffer", async () => {
    // WebCrypto rejects views over shared memory, which the app allocates
    // once it is cross-origin isolated (Dictation needs that).
    const shared = new Uint8Array(new SharedArrayBuffer(3));
    shared.set(new TextEncoder().encode("abc"));
    expect(await computeChecksum(shared)).toBe(ABC_SHA256);
  });

  it("hashes only the viewed slice of a larger buffer", async () => {
    const backing = new TextEncoder().encode("xxabcxx");
    expect(await computeChecksum(backing.subarray(2, 5))).toBe(ABC_SHA256);
  });
});
