import { describe, expect, it } from "vitest";
import { base64ToBytes, bytesToBase64 } from "@/plugin-sdk/protocol";

// Deterministic bytes: run `seed` starts at byte `seed` and steps by one, so a
// sweep of seeds puts every byte value at every alignment, and a failure prints
// the same input on every run.
function byteRamp(size: number, seed: number): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = (seed + i) & 0xff;
  return bytes;
}

describe("bytesToBase64", () => {
  it("matches Buffer for byte ramps of 0 to 5 bytes", () => {
    for (let size = 0; size <= 5; size++) {
      for (let seed = 0; seed < 25; seed++) {
        const bytes = byteRamp(size, seed);
        const encoded = bytesToBase64(bytes);
        expect(encoded).toBe(Buffer.from(bytes).toString("base64"));
        expect(Array.from(base64ToBytes(encoded))).toEqual(Array.from(bytes));
      }
    }
  });

  it("matches Buffer for a one megabyte buffer of every byte value", () => {
    // A 1 MiB ramp steps through all 256 values at all three base64 phases.
    const bytes = byteRamp(1024 * 1024, 0);
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });
});
