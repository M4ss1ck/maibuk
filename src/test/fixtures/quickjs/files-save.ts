/**
 * A Plugin fixture for the QuickJS `files.save` path (#516): a real Plugin built
 * from the real SDK, driven over the Worker scope. It takes a scope message
 * naming a file and its bytes as numbers, builds the `Uint8Array` inside the
 * VM (a typed array from outside crosses in as an `ArrayBuffer`), calls
 * `client.files.save`, and posts the outcome back.
 *
 * The engine has no `Blob`, so the SDK must fold the bytes and send them in the
 * `blob` slot as a `Uint8Array`; the test then asserts the host received them.
 *
 * This file is a Plugin source, not app code: it runs inside the QuickJS VM,
 * where `globalThis` is the worker scope.
 */

import {
  createPluginClient,
  PLUGIN_READY_MESSAGE,
  type PluginApiError,
  type PluginClient,
} from "@/plugin-sdk";

interface HarnessPort {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent) => void) | null;
}

interface HarnessScope {
  onmessage: ((event: { data: unknown; ports: readonly HarnessPort[] }) => void) | null;
  postMessage(data: unknown): void;
}

interface SaveRequest {
  kind: "maibuk:harness-save";
  id: number;
  name: string;
  mimeType: string;
  bytes: readonly number[];
}

const scope = globalThis as unknown as HarnessScope;

let client: PluginClient | null = null;

scope.onmessage = (event) => {
  if (client === null) {
    const port = event.ports[0];
    if (!port) return;
    client = createPluginClient(port);
    scope.postMessage(PLUGIN_READY_MESSAGE);
    return;
  }
  const message = event.data as SaveRequest;
  if (message.kind !== "maibuk:harness-save") return;
  client.files
    .save({
      name: message.name,
      mimeType: message.mimeType,
      bytes: new Uint8Array(message.bytes),
    })
    .then(
      (result) =>
        scope.postMessage({
          kind: "maibuk:harness-save-result",
          id: message.id,
          result,
          // Proves the call took the no-Blob path, not an engine that had one.
          hasBlob: typeof Blob !== "undefined",
        }),
      (error: unknown) => {
        const typed = error as PluginApiError;
        scope.postMessage({
          kind: "maibuk:harness-save-result",
          id: message.id,
          code: typed.code ?? null,
          message: typed.message ?? String(error),
        });
      }
    );
};
