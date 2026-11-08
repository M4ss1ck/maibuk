// The sandbox wire harness (issue #434; audit fixes on #478): runs the real
// host strings — the Worker prelude and the frame bootstrap — in a live page,
// with no Plugin Directory and no OPFS, so the specs can prove how they route
// messages on every engine. It is setup-only, like the storage helpers: page
// script, never an assertion surface.

import type { Page } from "@playwright/test";
import { BOOTSTRAP_HTML, PRELUDE_SOURCE } from "@/features/plugins/sandbox";
import {
  PLUGIN_BOOT_MESSAGE,
  PLUGIN_INIT_MESSAGE,
  PLUGIN_READY_MESSAGE,
} from "@/plugin-sdk/protocol";

/** How long a harness lets a Worker or frame settle before it counts. */
const SETTLE_MS = 300;

export type PreludeShape = "onmessage" | "addEventListener";

export interface PreludeShapeRun {
  shape: PreludeShape;
  /**
   * The init counts the Plugin posted. A correct prelude hands over the init
   * exactly once, so this is [1]; the fixture caps the report at 5 so a
   * re-entrant prelude cannot flood the host.
   */
  inits: number[];
}

export interface BootstrapRun {
  /** `maibuk:plugin-ready` forwards the host window saw. */
  readyForwards: number;
  /** Forwards of the Plugin's own `spam` posts the host window saw. */
  spamForwards: number;
  /** `worker-error` forwards the host window saw. */
  errorForwards: number;
}

/** The fixture Plugin's entry module for one handler registration shape. */
function preludeEntrySource(shape: PreludeShape): string {
  const register =
    shape === "onmessage"
      ? "self.onmessage = handler;"
      : 'self.addEventListener("message", handler);';
  return `"use strict";
let inits = 0;
const handler = (event) => {
  if (!event.data || event.data.kind !== ${JSON.stringify(PLUGIN_INIT_MESSAGE.kind)}) return;
  inits += 1;
  const port = event.ports && event.ports[0];
  if (port && inits <= 5) port.postMessage(inits);
};
${register}
`;
}

interface PreludeHarnessInput {
  preludeSource: string;
  entrySource: string;
  shape: PreludeShape;
  bootKind: string;
  initKind: string;
  settleMs: number;
}

/**
 * Loads PRELUDE_SOURCE in a real Worker for a Plugin that registers with
 * `self.onmessage` or with `self.addEventListener`, reports every init count
 * the Plugin saw, and terminates the Worker.
 */
export function runPreludeShape(page: Page, shape: PreludeShape): Promise<PreludeShapeRun> {
  return page.evaluate<PreludeShapeRun, PreludeHarnessInput>(
    async (input) => {
      const preludeUrl = URL.createObjectURL(
        new Blob([input.preludeSource], { type: "text/javascript" })
      );
      const entryUrl = URL.createObjectURL(
        new Blob([input.entrySource], { type: "text/javascript" })
      );
      const worker = new Worker(preludeUrl);
      const channel = new MessageChannel();
      const inits: number[] = [];
      channel.port1.onmessage = (event) => {
        inits.push(event.data as number);
      };
      channel.port1.start();
      worker.postMessage({ kind: input.bootKind, entry: entryUrl });
      worker.postMessage({ kind: input.initKind }, [channel.port2]);
      const deadline = Date.now() + 5_000;
      while (inits.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await new Promise((resolve) => setTimeout(resolve, input.settleMs));
      worker.terminate();
      channel.port1.close();
      URL.revokeObjectURL(preludeUrl);
      URL.revokeObjectURL(entryUrl);
      return { shape: input.shape, inits };
    },
    {
      preludeSource: PRELUDE_SOURCE,
      entrySource: preludeEntrySource(shape),
      shape,
      bootKind: PLUGIN_BOOT_MESSAGE.kind,
      initKind: PLUGIN_INIT_MESSAGE.kind,
      settleMs: SETTLE_MS,
    }
  );
}

interface BootstrapHarnessInput {
  bootstrapHtml: string;
  pluginSource: string;
  readyKind: string;
  settleMs: number;
}

/**
 * Starts the real bootstrap in a sandboxed iframe, hands it one module whose
 * Plugin posts `maibuk:plugin-ready` and then 20 `spam` messages, and counts
 * what reaches the host window: the bootstrap must forward the first ready
 * (and nothing else).
 */
export function runBootstrapForwarding(page: Page): Promise<BootstrapRun> {
  const pluginSource = `"use strict";
self.onmessage = (event) => {
  if (!event.data || event.data.kind !== ${JSON.stringify(PLUGIN_INIT_MESSAGE.kind)}) return;
  self.postMessage({ kind: ${JSON.stringify(PLUGIN_READY_MESSAGE.kind)} });
  for (let i = 0; i < 20; i += 1) self.postMessage({ kind: "spam", n: i });
  self.postMessage({ kind: ${JSON.stringify(PLUGIN_READY_MESSAGE.kind)} });
};
`;
  return page.evaluate<BootstrapRun, BootstrapHarnessInput>(
    async (input) => {
      const frame = document.createElement("iframe");
      frame.setAttribute("sandbox", "allow-scripts");
      frame.hidden = true;
      document.body.appendChild(frame);
      const seen: Array<Record<string, unknown>> = [];
      const onMessage = (event: MessageEvent) => {
        if (event.source !== frame.contentWindow) return;
        if (typeof event.data === "object" && event.data !== null) {
          seen.push(event.data as Record<string, unknown>);
        }
      };
      window.addEventListener("message", onMessage);
      const waitFor = async (predicate: (message: Record<string, unknown>) => boolean) => {
        const deadline = Date.now() + 5_000;
        while (Date.now() < deadline) {
          const found = seen.find(predicate);
          if (found) return found;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        throw new Error("The sandbox bootstrap never reached the harness");
      };
      try {
        frame.srcdoc = input.bootstrapHtml;
        await waitFor((message) => message.kind === "bootstrap-ready");
        frame.contentWindow?.postMessage(
          { kind: "create-module", id: 1, source: input.pluginSource },
          "*"
        );
        const created = await waitFor(
          (message) => message.kind === "module-created" && message.id === 1
        );
        const channel = new MessageChannel();
        frame.contentWindow?.postMessage({ kind: "start-worker", url: created.url }, "*", [
          channel.port2,
        ]);
        await waitFor(
          (message) => message.kind === "worker-message" || message.kind === "worker-error"
        );
        await new Promise((resolve) => setTimeout(resolve, input.settleMs));
        const forwarded = seen
          .filter((message) => message.kind === "worker-message")
          .map((message) => message.data as Record<string, unknown> | undefined);
        return {
          readyForwards: forwarded.filter((data) => data?.kind === input.readyKind).length,
          spamForwards: forwarded.filter((data) => data?.kind === "spam").length,
          errorForwards: seen.filter((message) => message.kind === "worker-error").length,
        };
      } finally {
        window.removeEventListener("message", onMessage);
        frame.remove();
      }
    },
    {
      bootstrapHtml: BOOTSTRAP_HTML,
      pluginSource,
      readyKind: PLUGIN_READY_MESSAGE.kind,
      settleMs: SETTLE_MS,
    }
  );
}

/** The deterministic payload of the Blob transport proof: 3 MiB. */
export const PLUGIN_BLOB_BYTES = 3 * 1024 * 1024;

/** The declared type of that payload; the host must see the same one. */
export const PLUGIN_BLOB_TYPE = "image/png";

/** The seed both sides run the same LCG from, so the payload is reproducible. */
const PLUGIN_BLOB_SEED = 0x9e3779b9;

/** What the host received, compared against the bytes it derived itself. */
export interface BlobTransportRun {
  /** The message's `blob` was a real `Blob` in the host realm. */
  isBlob: boolean;
  /** The `id` the blob arrived under. */
  id: number | null;
  size: number;
  type: string;
  /** The Blob's size the Plugin read back after posting (-1 when it could not). */
  afterPostSize: number;
  /** First byte where the received payload differs from the derived one, or -1. */
  firstMismatch: number;
}

/**
 * The Plugin side of the Blob proof, shared by both realms: derives the
 * deterministic payload with a small LCG, posts it as a Blob over the Plugin's
 * MessagePort with no transfer list (a structured clone), then reads the Blob
 * back to prove the post left it intact.
 */
function blobPluginSource(): string {
  return `"use strict";
function fillBytes() {
  const bytes = new Uint8Array(${PLUGIN_BLOB_BYTES});
  let state = ${PLUGIN_BLOB_SEED};
  for (let index = 0; index < bytes.length; index += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    bytes[index] = state >>> 24;
  }
  return bytes;
}
self.onmessage = async (event) => {
  if (!event.data || event.data.kind !== ${JSON.stringify(PLUGIN_INIT_MESSAGE.kind)}) return;
  const port = event.ports && event.ports[0];
  if (!port) return;
  const blob = new Blob([fillBytes()], { type: ${JSON.stringify(PLUGIN_BLOB_TYPE)} });
  port.postMessage({ kind: "blob", id: 1, blob });
  let size = -1;
  try { size = (await blob.arrayBuffer()).byteLength; } catch (error) { size = -1; }
  port.postMessage({ kind: "blob-after-post", id: 1, size: size });
};
`;
}

interface BlobHarnessInput {
  mode: "worker" | "frame";
  preludeSource: string;
  bootstrapHtml: string;
  pluginSource: string;
  bootKind: string;
  initKind: string;
}

/**
 * Posts the Blob proof's payload from a Plugin Worker — in the page's own
 * realm, or inside the real `sandbox="allow-scripts"` bootstrap frame — over
 * the Plugin MessagePort, and reports what the host received. This is both
 * halves of ADR 0040's transport claim; the spec makes the assertions.
 */
export function runBlobTransport(page: Page, mode: "worker" | "frame"): Promise<BlobTransportRun> {
  return page.evaluate<BlobTransportRun, BlobHarnessInput>(
    async (input) => {
      // The same LCG as the Plugin side, so both derive the same bytes.
      const fillBytes = () => {
        const bytes = new Uint8Array(3 * 1024 * 1024);
        let state = 0x9e3779b9;
        for (let index = 0; index < bytes.length; index += 1) {
          state = (state * 1664525 + 1013904223) >>> 0;
          bytes[index] = state >>> 24;
        }
        return bytes;
      };
      const inbox: { blob: Blob | null; id: number | null; afterPostSize: number | null } = {
        blob: null,
        id: null,
        afterPostSize: null,
      };
      const onPortMessage = (event: MessageEvent) => {
        const data = event.data as Record<string, unknown> | null;
        if (!data || typeof data !== "object") return;
        if (data.kind === "blob") {
          inbox.blob = data.blob as Blob;
          inbox.id = typeof data.id === "number" ? data.id : null;
        }
        if (data.kind === "blob-after-post") inbox.afterPostSize = Number(data.size);
      };
      const channel = new MessageChannel();
      channel.port1.onmessage = onPortMessage;
      channel.port1.start();
      const frame = input.mode === "frame" ? document.createElement("iframe") : null;
      const seen: Array<Record<string, unknown>> = [];
      const onWindowMessage = (event: MessageEvent) => {
        if (event.source !== frame?.contentWindow) return;
        if (typeof event.data === "object" && event.data !== null) {
          seen.push(event.data as Record<string, unknown>);
        }
      };
      let worker: Worker | null = null;
      const urls: string[] = [];
      try {
        if (frame) {
          frame.setAttribute("sandbox", "allow-scripts");
          frame.hidden = true;
          document.body.appendChild(frame);
          window.addEventListener("message", onWindowMessage);
          const waitFor = async (predicate: (message: Record<string, unknown>) => boolean) => {
            const deadline = Date.now() + 15_000;
            while (Date.now() < deadline) {
              const found = seen.find(predicate);
              if (found) return found;
              await new Promise((resolve) => setTimeout(resolve, 10));
            }
            throw new Error("The sandbox bootstrap never reached the harness");
          };
          frame.srcdoc = input.bootstrapHtml;
          await waitFor((message) => message.kind === "bootstrap-ready");
          frame.contentWindow?.postMessage(
            { kind: "create-module", id: 1, source: input.pluginSource },
            "*"
          );
          const created = await waitFor(
            (message) => message.kind === "module-created" && message.id === 1
          );
          frame.contentWindow?.postMessage({ kind: "start-worker", url: created.url }, "*", [
            channel.port2,
          ]);
        } else {
          const preludeUrl = URL.createObjectURL(
            new Blob([input.preludeSource], { type: "text/javascript" })
          );
          const entryUrl = URL.createObjectURL(
            new Blob([input.pluginSource], { type: "text/javascript" })
          );
          urls.push(preludeUrl, entryUrl);
          worker = new Worker(preludeUrl);
          worker.postMessage({ kind: input.bootKind, entry: entryUrl });
          worker.postMessage({ kind: input.initKind }, [channel.port2]);
        }
        const deadline = Date.now() + 15_000;
        while ((inbox.blob === null || inbox.afterPostSize === null) && Date.now() < deadline) {
          const workerError = seen.find((message) => message.kind === "worker-error");
          if (workerError) throw new Error(String(workerError.message));
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        if (inbox.blob === null || inbox.afterPostSize === null) {
          throw new Error("The Plugin never posted its Blob");
        }
        const blob = inbox.blob;
        const received = new Uint8Array(await blob.arrayBuffer());
        const expected = fillBytes();
        let firstMismatch = received.length === expected.length ? -1 : expected.length;
        for (let index = 0; firstMismatch === -1 && index < expected.length; index += 1) {
          if (received[index] !== expected[index]) firstMismatch = index;
        }
        return {
          isBlob: blob instanceof Blob,
          id: inbox.id,
          size: blob.size,
          type: blob.type,
          afterPostSize: inbox.afterPostSize,
          firstMismatch,
        };
      } finally {
        worker?.terminate();
        if (frame) {
          window.removeEventListener("message", onWindowMessage);
          frame.remove();
        }
        for (const url of urls) URL.revokeObjectURL(url);
      }
    },
    {
      mode,
      preludeSource: PRELUDE_SOURCE,
      bootstrapHtml: BOOTSTRAP_HTML,
      pluginSource: blobPluginSource(),
      bootKind: PLUGIN_BOOT_MESSAGE.kind,
      initKind: PLUGIN_INIT_MESSAGE.kind,
    }
  );
}
