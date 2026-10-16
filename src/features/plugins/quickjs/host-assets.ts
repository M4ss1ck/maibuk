/**
 * The Android QuickJS engine's host assets (#516): the two things the sandbox
 * Worker cannot fetch itself, because the frame keeps `connect-src 'none'`.
 *
 * - `runnerSource` is the text of the bundled runner ES module built from
 *   `worker-entry.ts` (`?worker&url`): the host fetches it from its own origin
 *   and hands it to the frame's `create-module`, which turns it into the one
 *   `blob:` URL the Worker imports. The frame never fetches.
 * - `wasmModule` is the QuickJS Wasm, compiled on the host from the variant's
 *   `?url` asset and passed to the Worker as a structured-clonable value, so the
 *   Worker instantiates it without a network fetch.
 *
 * Both are memoized: one load per app, however many Plugins start. This module
 * is reached only through the flag-guarded dynamic import in `runtime.ts`, so a
 * web or desktop bundle carries none of it.
 */

import wasmUrl from "@jitl/quickjs-ng-wasmfile-release-sync/wasm?url";
import runnerUrl from "@/features/plugins/quickjs/worker-entry.ts?worker&url";

export interface QuickJsEngineAssets {
  /** The text of the bundled runner module the frame turns into a `blob:` URL. */
  runnerSource: string;
  /** The host-compiled QuickJS Wasm module. */
  wasmModule: WebAssembly.Module;
}

let assets: Promise<QuickJsEngineAssets> | null = null;

/**
 * Loads the runner module text and the compiled QuickJS Wasm module once. The
 * same promise answers every caller; a failure is not retried, because a missing
 * engine asset is a build problem, not a transient one.
 */
export function loadQuickJsEngineAssets(): Promise<QuickJsEngineAssets> {
  assets ??= load();
  return assets;
}

async function load(): Promise<QuickJsEngineAssets> {
  const [runnerResponse, wasmResponse] = await Promise.all([fetch(runnerUrl), fetch(wasmUrl)]);
  if (!runnerResponse.ok) {
    throw new Error(
      `The QuickJS runner module could not be loaded (HTTP ${runnerResponse.status})`
    );
  }
  if (!wasmResponse.ok) {
    throw new Error(`The QuickJS engine could not be loaded (HTTP ${wasmResponse.status})`);
  }
  const [runnerSource, wasmBytes] = await Promise.all([
    runnerResponse.text(),
    wasmResponse.arrayBuffer(),
  ]);
  const wasmModule = await WebAssembly.compile(wasmBytes);
  return { runnerSource, wasmModule };
}
