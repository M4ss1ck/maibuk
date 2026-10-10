/**
 * The sandbox frame (ADR 0019): a hidden, host-owned
 * `<iframe sandbox="allow-scripts" srcdoc>` with an opaque origin, never
 * `allow-same-origin`. Its document is fixed host code — a CSP that refuses
 * every network path and a bootstrap that only turns host-sent module sources
 * into `blob:` URLs, starts one Worker from a fixed host prelude, and forwards
 * messages and the one MessagePort. It never evaluates Plugin bytes and never
 * loads Plugin HTML; the gate suite enforces both.
 *
 * The bootstrap and the prelude are strings because they must be host code
 * inside the frame's own document and inside the Worker; only the entry module
 * the prelude imports is Plugin code.
 *
 * Why the Worker is classic, not a module Worker: Chromium refuses a module
 * Worker started from a `blob:` URL in an opaque-origin document (module
 * scripts fetch in CORS mode, and the blob URL store check fails for a null
 * origin), while a classic Worker from the same blob starts in Chromium,
 * Firefox, and WebKit. The prelude is therefore the Worker's own script; it
 * dynamically imports the host-verified entry module and replays the init
 * message to the Plugin's handler. Verified on all three engines.
 */

import type { PluginSandboxFrame } from "@/features/plugins/types";
import {
  PLUGIN_BOOT_MESSAGE,
  PLUGIN_ERROR_MESSAGE,
  PLUGIN_INIT_MESSAGE,
} from "@/plugin-sdk/protocol";

/** The prelude's error report; the bootstrap turns it into a Worker error. */
const PLUGIN_ERROR_KIND = PLUGIN_ERROR_MESSAGE.kind;

/**
 * The fixed host prelude every sandbox Worker runs. It holds the boot and init
 * messages until it has both, imports the host-verified entry module, and
 * hands the init message — its MessagePort included — to the Plugin's own
 * handler (or dispatches a fresh one for a Plugin that used
 * `addEventListener`).
 */
export const PRELUDE_SOURCE = `"use strict";
(() => {
  let entry = null;
  let initEvent = null;
  const preludeHandler = (event) => {
    const message = event.data;
    if (typeof message !== "object" || message === null) return;
    if (message.kind === "${PLUGIN_BOOT_MESSAGE.kind}" && typeof message.entry === "string") {
      entry = message.entry;
    } else if (message.kind === "${PLUGIN_INIT_MESSAGE.kind}") {
      initEvent = event;
    } else {
      return;
    }
    void boot();
  };
  self.onmessage = preludeHandler;

  async function boot() {
    if (entry === null || initEvent === null) return;
    const event = initEvent;
    initEvent = null;
    try {
      await import(entry);
    } catch (error) {
      self.postMessage({
        kind: "${PLUGIN_ERROR_KIND}",
        message: String((error && error.message) || error),
      });
      return;
    }
    const pluginHandler = self.onmessage;
    if (pluginHandler && pluginHandler !== preludeHandler) {
      pluginHandler.call(self, event);
    } else {
      self.dispatchEvent(new MessageEvent("message", { data: event.data, ports: event.ports }));
    }
  }
})();
`;

/**
 * `script-src` needs `blob:` for the prelude Worker and the module URLs the
 * frame creates, `'unsafe-inline'` for this bootstrap, and
 * `'wasm-unsafe-eval'` so a Plugin may load its own hashed Wasm;
 * `connect-src 'none'` is the platform-level network block. Kept as one meta
 * tag; a sandboxed frame is one per Plugin.
 */
export const BOOTSTRAP_HTML = `<!doctype html>
<html>
<head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob: 'wasm-unsafe-eval'; worker-src blob:; connect-src 'none'; img-src 'none'; style-src 'none'; font-src 'none'; media-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'">
</head>
<body>
<script>
"use strict";
(() => {
  const host = window.parent;
  const send = (message) => host.postMessage(message, "*");
  const preludeSource = ${JSON.stringify(PRELUDE_SOURCE)};
  window.addEventListener("message", (event) => {
    // Only the host window may talk to this frame, and only with data.
    if (event.source !== host) return;
    const message = event.data;
    if (typeof message !== "object" || message === null) return;
    try {
      if (message.kind === "create-module" && typeof message.source === "string") {
        const url = URL.createObjectURL(new Blob([message.source], { type: "text/javascript" }));
        send({ kind: "module-created", id: message.id, url: url });
        return;
      }
      if (message.kind === "start-worker" && typeof message.url === "string") {
        const port = event.ports[0];
        if (!port) {
          send({ kind: "sandbox-error", message: "start-worker arrived without a MessagePort" });
          return;
        }
        const prelude = URL.createObjectURL(new Blob([preludeSource], { type: "text/javascript" }));
        const worker = new Worker(prelude);
        worker.onmessage = (workerEvent) => {
          const data = workerEvent.data;
          if (data && typeof data === "object" && data.kind === "${PLUGIN_ERROR_KIND}") {
            send({ kind: "worker-error", message: String(data.message) });
            return;
          }
          send({ kind: "worker-message", data: data });
        };
        worker.onerror = (workerEvent) =>
          send({
            kind: "worker-error",
            message: String((workerEvent && workerEvent.message) || "Worker error"),
            filename: String((workerEvent && workerEvent.filename) || ""),
            lineno: Number((workerEvent && workerEvent.lineno) || 0),
          });
        worker.postMessage({ kind: "${PLUGIN_BOOT_MESSAGE.kind}", entry: message.url });
        worker.postMessage({ kind: "${PLUGIN_INIT_MESSAGE.kind}" }, [port]);
      }
    } catch (error) {
      send({ kind: "sandbox-error", message: String((error && error.message) || error) });
    }
  });
  send({ kind: "bootstrap-ready" });
})();
</script>
</body>
</html>
`;

interface PendingModule {
  resolve: (url: string) => void;
  reject: (error: Error) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Creates one sandbox frame for one Plugin start. The caller must await
 * `ready` before `createModule`, and must `stop()` the frame when the Plugin
 * stops; removing the frame terminates its Worker.
 */
export function createPluginFrame(doc: Document): PluginSandboxFrame {
  const element = doc.createElement("iframe");
  element.setAttribute("sandbox", "allow-scripts");
  element.setAttribute("aria-hidden", "true");
  element.setAttribute("inert", "");
  element.tabIndex = -1;
  // Invisible but loaded: `display: none` is fine in every engine, yet a
  // zero-sized off-screen frame cannot be throttled or scrolled into view.
  element.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;border:0;visibility:hidden";

  let stopped = false;
  let nextModuleId = 1;
  const pendingModules = new Map<number, PendingModule>();
  let workerMessage: ((data: unknown) => void) | null = null;
  let workerError: ((message: string) => void) | null = null;

  let settleReady: () => void;
  let failReady: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    settleReady = resolve;
    failReady = reject;
  });
  let readySettled = false;

  function failPending(error: Error) {
    for (const pending of pendingModules.values()) pending.reject(error);
    pendingModules.clear();
  }

  function handleFrameMessage(event: MessageEvent) {
    if (event.source !== element.contentWindow) return;
    const message: unknown = event.data;
    if (!isRecord(message)) return;
    switch (message.kind) {
      case "bootstrap-ready":
        readySettled = true;
        settleReady();
        return;
      case "module-created": {
        const pending = pendingModules.get(message.id as number);
        pendingModules.delete(message.id as number);
        pending?.resolve(String(message.url));
        return;
      }
      case "worker-message":
        workerMessage?.(message.data);
        return;
      case "worker-error": {
        const where =
          typeof message.filename === "string" && message.filename !== ""
            ? ` (${message.filename}:${String(message.lineno)})`
            : "";
        const text = `${String(message.message)}${where}`;
        const error = new Error(text);
        if (!readySettled) {
          readySettled = true;
          failReady(error);
        } else {
          workerError?.(text);
        }
        return;
      }
      case "sandbox-error": {
        const error = new Error(String(message.message));
        if (!readySettled) {
          readySettled = true;
          failReady(error);
        }
        failPending(error);
        return;
      }
    }
  }

  window.addEventListener("message", handleFrameMessage);

  element.srcdoc = BOOTSTRAP_HTML;
  doc.body.appendChild(element);

  function post(message: Record<string, unknown>, transfer?: Transferable[]) {
    element.contentWindow?.postMessage(message, "*", transfer ?? []);
  }

  return {
    element,
    ready,
    createModule(source: string): Promise<string> {
      if (stopped) return Promise.reject(new Error("The sandbox frame is stopped"));
      const id = nextModuleId++;
      return new Promise<string>((resolve, reject) => {
        pendingModules.set(id, { resolve, reject });
        post({ kind: "create-module", id, source });
      });
    },
    async startWorker(entryUrl: string, port: MessagePort): Promise<void> {
      post({ kind: "start-worker", url: entryUrl }, [port]);
    },
    onWorkerMessage(handler) {
      workerMessage = handler;
    },
    onWorkerError(handler) {
      workerError = handler;
    },
    stop() {
      if (stopped) return;
      stopped = true;
      window.removeEventListener("message", handleFrameMessage);
      // Removing the frame destroys its document, which terminates its
      // Worker; no stop message is needed.
      element.remove();
      failPending(new Error("The sandbox frame is stopped"));
    },
  };
}
