export async function computeChecksum(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : unshared(data);
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

// WebCrypto rejects views over a SharedArrayBuffer, so those are copied out.
function unshared(data: Uint8Array): Uint8Array<ArrayBuffer> {
  return isOwned(data) ? data : new Uint8Array(data);
}

function isOwned(data: Uint8Array): data is Uint8Array<ArrayBuffer> {
  return data.buffer instanceof ArrayBuffer;
}
