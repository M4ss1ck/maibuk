// Downloaded files on the web live in the Cache API, one entry per file. The
// install marker written last is what makes a complete set.
import type { DownloadedFiles } from "@/lib/verified-download";

export function webDownloadedFiles(cacheName: string, prefix: string): DownloadedFiles {
  const key = (id: string, name: string) => `${prefix}${id}/${name}`;

  async function removeAll(id: string): Promise<void> {
    const cache = await caches.open(cacheName);
    const folder = `${prefix}${id}/`;
    for (const request of await cache.keys()) {
      const path = new URL(request.url).pathname;
      if (path.startsWith(folder)) await cache.delete(path);
    }
  }

  return {
    async read(id, name) {
      const cache = await caches.open(cacheName);
      const response = await cache.match(key(id, name));
      return response ? new Uint8Array(await response.arrayBuffer()) : null;
    },
    async write(id, name, data) {
      const cache = await caches.open(cacheName);
      await cache.put(key(id, name), new Response(new Uint8Array(data)));
    },
    remove: removeAll,
  };
}
