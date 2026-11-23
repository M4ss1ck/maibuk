/**
 * SHA-256 (FIPS 180-4) in plain TypeScript, no dependency and no platform API.
 *
 * Reader needs it for the Fingerprint, and the Fingerprint is built in the
 * Plugin Worker: a Worker started from a `blob:` URL is not a secure context,
 * so `crypto.subtle` is undefined there. The pure implementation gives the same
 * digest in the Worker, the app, and a test. A pure hash of a large buffer can
 * hold a slow device's Worker past the host's heartbeat, so `createSha256`
 * takes the message in pieces and the Fingerprint yields between them.
 */

/** The 64 round constants: the first 32 bits of the cube roots of the primes. */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** The initial hash value: the first 32 bits of the square roots of the primes. */
const INITIAL = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

/** A 32-bit right rotation. */
function rotr(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

/** A SHA-256 fed in pieces: the same digest as hashing the pieces joined. */
export interface Sha256 {
  /** Feeds the next bytes of the message. */
  update(bytes: Uint8Array): void;
  /** Pads the message and returns its digest as 64 lowercase hex characters. */
  digestHex(): string;
}

/**
 * A SHA-256 that takes the message in pieces, so a caller can hash a large
 * buffer a slice at a time and yield between slices. The Fingerprint does, so
 * the Plugin Worker keeps answering the host's heartbeat on a slow device.
 */
export function createSha256(): Sha256 {
  const hash = new Uint32Array(INITIAL);
  const w = new Uint32Array(64);
  /** The bytes of a block not yet full. */
  const pending = new Uint8Array(64);
  let pendingLength = 0;
  /** The message length so far, in bytes. */
  let length = 0;

  /** Runs one 64-byte block at `offset` of `block` through the compression. */
  function compress(block: Uint8Array, offset: number): void {
    for (let index = 0; index < 16; index++) {
      const at = offset + index * 4;
      w[index] =
        ((block[at] << 24) | (block[at + 1] << 16) | (block[at + 2] << 8) | block[at + 3]) >>> 0;
    }
    for (let index = 16; index < 64; index++) {
      const s0 = rotr(w[index - 15], 7) ^ rotr(w[index - 15], 18) ^ (w[index - 15] >>> 3);
      const s1 = rotr(w[index - 2], 17) ^ rotr(w[index - 2], 19) ^ (w[index - 2] >>> 10);
      w[index] = (w[index - 16] + s0 + w[index - 7] + s1) >>> 0;
    }

    let a = hash[0];
    let b = hash[1];
    let c = hash[2];
    let d = hash[3];
    let e = hash[4];
    let f = hash[5];
    let g = hash[6];
    let h = hash[7];

    for (let index = 0; index < 64; index++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const choose = (e & f) ^ (~e & g);
      const t1 = (h + s1 + choose + K[index] + w[index]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }

    hash[0] += a;
    hash[1] += b;
    hash[2] += c;
    hash[3] += d;
    hash[4] += e;
    hash[5] += f;
    hash[6] += g;
    hash[7] += h;
  }

  function update(bytes: Uint8Array): void {
    length += bytes.length;
    let offset = 0;
    if (pendingLength > 0) {
      const take = Math.min(64 - pendingLength, bytes.length);
      pending.set(bytes.subarray(0, take), pendingLength);
      pendingLength += take;
      offset = take;
      if (pendingLength < 64) return;
      compress(pending, 0);
      pendingLength = 0;
    }
    for (; offset + 64 <= bytes.length; offset += 64) compress(bytes, offset);
    pending.set(bytes.subarray(offset), 0);
    pendingLength = bytes.length - offset;
  }

  /**
   * The padding is one 0x80 byte, zeros, then the length in bits as a 64-bit
   * big-endian integer, filling the last block or spilling into one more.
   */
  function digestHex(): string {
    const tailLength = pendingLength + 9 > 64 ? 128 : 64;
    const tail = new Uint8Array(tailLength);
    tail.set(pending.subarray(0, pendingLength));
    tail[pendingLength] = 0x80;
    const view = new DataView(tail.buffer);
    // The bit length as two words: 2^32 bits is 2^29 bytes, and `<< 3` keeps
    // the low word modulo 2^32.
    view.setUint32(tailLength - 8, Math.floor(length / 0x20000000));
    view.setUint32(tailLength - 4, (length << 3) >>> 0);
    for (let offset = 0; offset < tailLength; offset += 64) compress(tail, offset);

    let hex = "";
    for (const word of hash) hex += word.toString(16).padStart(8, "0");
    return hex;
  }

  return { update, digestHex };
}

/** The SHA-256 digest of `bytes`, as 64 lowercase hex characters. */
export function sha256Hex(bytes: Uint8Array): string {
  const hash = createSha256();
  hash.update(bytes);
  return hash.digestHex();
}
