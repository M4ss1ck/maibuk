/**
 * The Worker entry's one compatibility shim (#594). MCP Server runs in the
 * Plugin sandbox, a `<iframe sandbox="allow-scripts">` Worker with an opaque
 * origin, which is not a secure context: its Web Crypto API has
 * `getRandomValues` but no `randomUUID`. The MCP SDK's HTTP transport calls
 * `crypto.randomUUID()` once for every JSON-RPC request it handles (the stream
 * id), so without this the first `initialize` throws inside the transport and
 * the Agent sees `400 Parse error`.
 *
 * The shim fills only the missing function, from `getRandomValues`, and leaves
 * a native `randomUUID` alone, so desktop engines and tests keep their own.
 * `crypto.subtle` is not shimmed: nothing on the request path reaches it (the
 * SDK's `createRequestStateCodec`, the only caller, is a helper this Plugin
 * never uses).
 */

/** The one Web Crypto method the shim reads, narrowed to the bytes it fills. */
export interface RandomSource {
  getRandomValues(array: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer>;
}

/** The Worker's `crypto`: a random source that may be missing `randomUUID`. */
export type RandomUuidTarget = RandomSource & { randomUUID?: unknown };

/**
 * A random RFC 4122 version 4 UUID in the canonical lowercase
 * `8-4-4-4-12` form, drawn from `source.getRandomValues`.
 */
export function randomUuidV4(source: RandomSource): string {
  const bytes = new Uint8Array(16);
  source.getRandomValues(bytes);
  // Version 4 in the high nibble of byte 6, and the RFC 4122 variant (10xx) in
  // the two high bits of byte 8; the other 122 bits stay random.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Installs `randomUUID` on `target` (the Worker's `crypto` by default) when it
 * has none. Returns whether it installed one; a native `randomUUID` is never
 * touched, so the Worker entry can call this unconditionally.
 */
export function installRandomUuid(target: RandomUuidTarget = globalThis.crypto): boolean {
  if (typeof target.randomUUID === "function") return false;
  Object.defineProperty(target, "randomUUID", {
    value: () => randomUuidV4(target),
    writable: true,
    configurable: true,
  });
  return true;
}
