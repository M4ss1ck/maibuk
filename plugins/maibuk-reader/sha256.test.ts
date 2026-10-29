/**
 * Reader's SHA-256 (#653). The Fingerprint hashes the first and last 64 KB of
 * every Document the author opens, so the digest has to be the FIPS 180-4 one:
 * these are the standard's own vectors, plus a random buffer checked against
 * Node's implementation.
 */

import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "./sha256";

const encoder = new TextEncoder();

describe("sha256Hex()", () => {
  it("hashes the empty message", () => {
    expect(sha256Hex(new Uint8Array(0))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
  });

  it("hashes abc", () => {
    expect(sha256Hex(encoder.encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });

  it("hashes the 448-bit message that pads into a second block", () => {
    const message = "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq";
    expect(sha256Hex(encoder.encode(message))).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
    );
  });

  it("hashes one million a", () => {
    const message = new Uint8Array(1_000_000).fill(0x61);
    expect(sha256Hex(message)).toBe(
      "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0"
    );
  });

  it("agrees with node:crypto on 128 KB of random bytes", () => {
    const message = new Uint8Array(randomBytes(128 * 1024));
    const expected = createHash("sha256").update(message).digest("hex");
    expect(sha256Hex(message)).toBe(expected);
  });
});
