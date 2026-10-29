/**
 * Plugin module loading. Planning (lexing, import checks, dependency order)
 * lives in module-plan.ts and runs in a one-shot Worker so es-module-lexer's
 * WebAssembly memory is released when the plan is done. This file rewrites the
 * accepted imports to the `blob:` URLs the sandbox frame creates, in dependency
 * order, because a module Worker started from a `blob:` URL cannot resolve
 * relative specifiers itself.
 */

import type {
  PluginFolderFile,
  PluginImportSite,
  PluginModulePlan,
} from "@/features/plugins/types";
import type {
  PluginModulePlanRequest,
  PluginModulePlanResponse,
} from "@/features/plugins/module-plan";

// Optional worker factory (used by tests to inject a fake). There are
// intentionally no other options.
export interface PluginModulePlanOptions {
  createWorker?: () => Worker;
}

function defaultCreateWorker(): (() => Worker) | undefined {
  if (typeof Worker === "undefined") return undefined;
  return () => new Worker(new URL("./modules.worker.ts", import.meta.url), { type: "module" });
}

// Worker path: the lexer runs in the module Worker, which is terminated once
// it has replied, whatever the outcome. The file bytes are sent with
// structured clone (no transfer list) because callers keep reusing
// files[].bytes after planning.
async function planViaWorker(
  files: readonly PluginFolderFile[],
  entry: string,
  createWorker: () => Worker
): Promise<PluginModulePlan> {
  let worker: Worker | null = null;
  try {
    worker = createWorker();
    const active = worker;
    // `return await` keeps the terminate in `finally` after the reply, not before.
    return await new Promise<PluginModulePlan>((resolve, reject) => {
      active.onmessage = (event: MessageEvent) => {
        const message = event.data as PluginModulePlanResponse;
        if (message?.type === "result") {
          resolve(message.plan);
        } else if (message?.type === "error") {
          reject(new Error(`Plugin module planning failed: ${message.message}`));
        } else {
          reject(new Error("Unexpected message from plugin module-plan worker"));
        }
      };
      // A failed Worker rejects; it never falls back to the main thread.
      active.onerror = (event: Event | string) => {
        const detail = typeof event === "string" ? event : "worker error";
        reject(new Error(`plugin module-plan worker failed: ${detail}`));
      };
      active.onmessageerror = () => {
        reject(new Error("plugin module-plan worker message failed to deserialize"));
      };
      const request: PluginModulePlanRequest = {
        type: "plan",
        files: files.map((file) => ({ path: file.path, bytes: file.bytes })),
        entry,
      };
      try {
        // No transfer list: a transferred buffer would be detached on the caller's side.
        active.postMessage(request);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  } finally {
    worker?.terminate();
  }
}

/**
 * Plans a Plugin's entry and every module it reaches. Runs in a one-shot
 * module Worker when the Worker API exists; falls back to a dynamic import of
 * module-plan.ts (which keeps the lexer off the main chunk) only when it does
 * not. A created Worker that fails rejects instead of falling back.
 */
export async function planPluginModules(
  files: readonly PluginFolderFile[],
  entry: string,
  options?: PluginModulePlanOptions
): Promise<PluginModulePlan> {
  const createWorker = options?.createWorker ?? defaultCreateWorker();
  if (!createWorker) {
    const { computePluginModulePlan } = await import("@/features/plugins/module-plan");
    return computePluginModulePlan(files, entry);
  }
  return planViaWorker(files, entry, createWorker);
}

/** Replaces every import site with the `blob:` URL of the module it names. */
export function rewritePluginImports(
  source: string,
  sites: readonly PluginImportSite[],
  urlOf: (path: string) => string
): string {
  let rewritten = source;
  const ordered = [...sites].sort((a, b) => b.start - a.start);
  for (const site of ordered) {
    const url = urlOf(site.target);
    const replacement = site.kind === "static" ? url : JSON.stringify(url);
    rewritten = rewritten.slice(0, site.start) + replacement + rewritten.slice(site.end);
  }
  return rewritten;
}
