// CRC32C (Castagnoli), the checksum Moonshine publishes per model file.
const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0x82f63b78 : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export interface Crc32c {
  update(bytes: Uint8Array): void;
  /** Base64 of the 4 big-endian bytes, the catalog's format. */
  digestBase64(): string;
}

/** Incremental, so a download can be checked chunk by chunk as it arrives. */
export function createCrc32c(): Crc32c {
  let crc = 0xffffffff;
  return {
    update(bytes) {
      let c = crc;
      for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
      crc = c;
    },
    digestBase64() {
      const value = (crc ^ 0xffffffff) >>> 0;
      const bytes = [value >>> 24, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
      return btoa(String.fromCharCode(...bytes));
    },
  };
}

export function crc32cBase64(bytes: Uint8Array): string {
  const crc = createCrc32c();
  crc.update(bytes);
  return crc.digestBase64();
}
