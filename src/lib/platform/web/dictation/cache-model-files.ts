// Dictation Models on the web live in the Cache API, one entry per file plus
// a completion marker written last. Readable from the dictation worker.
import { createCrc32c } from "@/features/dictation/crc32c";
import {
  DictationError,
  type ModelFiles,
  type ModelSpec,
} from "@/features/dictation/types";

export const CACHE_NAME = "maibuk-dictation-v1";
const key = (id: string, name: string) => `/dictation/${id}/${name}`;
const marker = (id: string) => key(id, ".complete");

async function removeAll(id: string): Promise<void> {
  const cache = await caches.open(CACHE_NAME);
  const prefix = `/dictation/${id}/`;
  for (const request of await cache.keys()) {
    const path = new URL(request.url).pathname;
    if (path.startsWith(prefix)) await cache.delete(path);
  }
}

async function download(
  file: ModelSpec["files"][number],
  signal: AbortSignal,
  onBytes: (n: number) => void,
): Promise<Blob> {
  const res = await fetch(file.url, { signal });
  if (res.status === 404 || res.status === 410)
    throw new DictationError("model_gone", file.url);
  if (!res.ok || !res.body)
    throw new DictationError(
      "download_failed",
      `${file.url}: HTTP ${res.status}`,
    );
  const crc = createCrc32c();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    crc.update(value);
    chunks.push(value);
    size += value.length;
    onBytes(value.length);
  }
  if (size !== file.bytes || crc.digestBase64() !== file.checksum.value) {
    throw new DictationError(
      "download_failed",
      `${file.name}: checksum or size mismatch`,
    );
  }
  return new Blob(chunks);
}

export const cacheModelFiles: ModelFiles = {
  async install(spec, onProgress, signal) {
    const total = spec.files.reduce((sum, f) => sum + f.bytes, 0);
    let done = 0;
    await removeAll(spec.id);
    try {
      const cache = await caches.open(CACHE_NAME);
      for (const file of spec.files) {
        if (signal.aborted) throw new DictationError("cancelled");
        const blob = await download(file, signal, (n) => {
          done += n;
          onProgress(done, total);
        });
        await cache.put(key(spec.id, file.name), new Response(blob));
      }
      if (signal.aborted) throw new DictationError("cancelled");
      await cache.put(
        marker(spec.id),
        new Response(JSON.stringify(spec.files.map((f) => [f.name, f.bytes]))),
      );
    } catch (error) {
      await removeAll(spec.id);
      if ((error as DOMException).name === "QuotaExceededError")
        throw new DictationError("disk_full");
      if ((error as DOMException).name === "AbortError")
        throw new DictationError("cancelled");
      throw error;
    }
  },
  async isComplete(spec) {
    const cache = await caches.open(CACHE_NAME);
    return (await cache.match(marker(spec.id))) !== undefined;
  },
  remove: removeAll,
};

/** Verified bytes for a load: marker present and every file its catalog size. */
export async function readModelFiles(
  spec: ModelSpec,
): Promise<Map<string, Uint8Array>> {
  const cache = await caches.open(CACHE_NAME);
  if (!(await cache.match(marker(spec.id))))
    throw new DictationError("model_corrupt", "not installed");
  const files = new Map<string, Uint8Array>();
  for (const file of spec.files) {
    const res = await cache.match(key(spec.id, file.name));
    const bytes = res ? new Uint8Array(await res.arrayBuffer()) : null;
    if (!bytes || bytes.byteLength !== file.bytes)
      throw new DictationError("model_corrupt", file.name);
    files.set(file.name, bytes);
  }
  return files;
}
