import { describe, expect, it } from "vitest";
import { installRandomUuid, randomUuidV4, type RandomSource, type RandomUuidTarget } from "./crypto-shim";

/**
 * The sandbox Worker's Web Crypto: the real `getRandomValues`, and no
 * `randomUUID`, which is how the opaque-origin Worker behaves (#594).
 */
function sandboxCrypto(): RandomUuidTarget {
  return {
    getRandomValues: (array: Uint8Array<ArrayBuffer>) => globalThis.crypto.getRandomValues(array),
  };
}

/** A source whose every random byte is `value`, so the bit masking is visible. */
function fixedBytes(value: number): RandomSource {
  return {
    getRandomValues(array: Uint8Array<ArrayBuffer>) {
      array.fill(value);
      return array;
    },
  };
}

/** The canonical lowercase RFC 4122 version 4 form. */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("installRandomUuid", () => {
  it("installs a v4 randomUUID when the Worker has none", () => {
    const target = sandboxCrypto();
    expect(target.randomUUID).toBeUndefined();

    expect(installRandomUuid(target)).toBe(true);
    const randomUUID = target.randomUUID as () => string;
    expect(typeof randomUUID).toBe("function");

    const first = randomUUID();
    const second = randomUUID();
    expect(first).toMatch(UUID_V4);
    expect(second).toMatch(UUID_V4);
    expect(first).not.toBe(second);
  });

  it("sets the version nibble to 4 and the RFC 4122 variant bits", () => {
    expect(randomUuidV4(fixedBytes(0xff))).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
    expect(randomUuidV4(fixedBytes(0x00))).toBe("00000000-0000-4000-8000-000000000000");
  });

  it("leaves a native randomUUID untouched", () => {
    const native = () => "native-uuid";
    const target: RandomUuidTarget = { ...sandboxCrypto(), randomUUID: native };

    expect(installRandomUuid(target)).toBe(false);
    expect(target.randomUUID).toBe(native);
    expect((target.randomUUID as () => string)()).toBe("native-uuid");
  });
});
