// src/features/deep-link/bridge.ts - buffered singleton, FIFO, StrictMode-safe
import { IS_TAURI } from "@/lib/platform";

let installed = false;
let transportInitPromise: Promise<void> | null = null;
let bootstrapUrls: string[] | null = null;
let bootstrapSettled = false;
let bootstrapConsumed = false;
let pendingBuffer: string[][] = [];
const queue: string[][] = [];
let processing = false;
let handlerRef: ((urls: string[]) => Promise<void>) | null = null;
let coldGateReleased = false;

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

async function ensureTransportInitialized(): Promise<void> {
  if (transportInitPromise) return transportInitPromise;
  if (!IS_TAURI) {
    bootstrapSettled = true;
    return;
  }
  transportInitPromise = (async () => {
    try {
      const { onOpenUrl } = await import("@tauri-apps/plugin-deep-link");
      await onOpenUrl(async (urls: string[]) => {
        const batch = Array.isArray(urls) ? urls : [];
        if (!bootstrapSettled) {
          pendingBuffer.push(batch);
          return;
        }
        queue.push(batch);
        void processQueue();
      });
    } catch {
      // plugin unavailable
    }

    try {
      const { getCurrent } = await import("@tauri-apps/plugin-deep-link");
      const urls = await getCurrent();
      if (Array.isArray(urls) && urls.length > 0) {
        bootstrapUrls = urls;
      } else {
        bootstrapUrls = null;
      }
    } catch {
      bootstrapUrls = null;
    }
    bootstrapSettled = true;

    // Drain pendingBuffer with single replay suppression
    let suppressedOnce = false;
    for (const batch of pendingBuffer) {
      if (!suppressedOnce && bootstrapUrls && arraysEqual(batch, bootstrapUrls)) {
        suppressedOnce = true;
        continue;
      }
      queue.push(batch);
    }
    pendingBuffer = [];
    void processQueue();
  })();
  return transportInitPromise;
}

export async function getDeepLinkBootstrap(): Promise<string[] | null> {
  if (!IS_TAURI) return null;
  await ensureTransportInitialized();
  bootstrapConsumed = true;
  return bootstrapUrls;
}

export function releaseDeepLinkQueue(): void {
  coldGateReleased = true;
  void processQueue();
}

async function processQueue(): Promise<void> {
  if (processing) return;
  if (!handlerRef) return;
  if (!bootstrapSettled) return;
  if (!coldGateReleased) return;
  // If bootstrap was not consumed via getDeepLinkBootstrap, enqueue it now
  if (bootstrapUrls && !bootstrapConsumed) {
    bootstrapConsumed = true;
    queue.unshift(bootstrapUrls);
  }
  processing = true;
  while (queue.length > 0 && handlerRef) {
    const batch = queue.shift()!;
    try {
      await handlerRef(batch);
    } catch {}
  }
  processing = false;
}

export async function installDeepLinkBridge(
  handler: (urls: string[]) => Promise<void>
): Promise<void> {
  handlerRef = handler;
  if (installed) {
    void ensureTransportInitialized().then(() => void processQueue());
    return;
  }
  installed = true;
  await ensureTransportInitialized();
  void processQueue();
}

export function uninstallDeepLinkBridge(): void {
  handlerRef = null;
}
