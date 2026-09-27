import { describe, expect, it } from "vitest";
import vectors from "@/test/fixtures/dictation/crc32c.json";
import { createCrc32c, crc32cBase64 } from "@/features/dictation/crc32c";

const fromHex = (hex: string) =>
  new Uint8Array(hex.match(/../g)?.map((b) => parseInt(b, 16)) ?? []);

const ascii = (text: string) => new TextEncoder().encode(text);

describe("crc32c", () => {
  it("matches the Castagnoli check vector", () => {
    const digest = Uint8Array.from(atob(crc32cBase64(ascii("123456789"))), (c) => c.charCodeAt(0));
    expect(new DataView(digest.buffer).getUint32(0)).toBe(0xe3069283);
  });

  it.each(vectors)("matches the shared vector $crc32c", ({ hex, crc32c }) => {
    expect(crc32cBase64(fromHex(hex))).toBe(crc32c);
  });

  it("is the same fed in chunks", () => {
    const bytes = fromHex("313233343536373839");
    const crc = createCrc32c();
    crc.update(bytes.subarray(0, 4));
    crc.update(new Uint8Array());
    crc.update(bytes.subarray(4));
    expect(crc.digestBase64()).toBe("4waSgw==");
  });
});
