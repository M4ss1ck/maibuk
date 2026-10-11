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
        frame.contentWindow?.postMessage(
          { kind: "start-worker", url: created.url },
          "*",
          [channel.port2]
        );
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
