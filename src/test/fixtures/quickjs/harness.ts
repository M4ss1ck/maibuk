/**
 * The QuickJS runner's harness Plugin (#516). It is a real Plugin built from
 * the real SDK (`@/plugin-sdk`), so the runner suite evaluates the exact bytes
 * a shipped Plugin bundles. On the init event it takes the port, creates an SDK
 * client, answers `health.check` with `pong`, and signals ready over the scope.
 * It then answers `maibuk:harness-call` scope messages by invoking one client
 * method and posting the outcome back, so the suite can prove an allowed call
 * round-trips and a refused one rejects with the SDK's typed error.
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

interface HarnessCall {
  kind: "maibuk:harness-call";
  id: number;
  path: readonly string[];
  params?: unknown;
}

const scope = globalThis as unknown as HarnessScope;

let client: PluginClient | null = null;

/** Walk `client` by a dotted path and call the method it names. */
function invoke(target: PluginClient, path: readonly string[], params: unknown): Promise<unknown> {
  let node: unknown = target;
  for (const part of path) node = (node as Record<string, unknown>)[part];
  return (node as (params: unknown) => Promise<unknown>)(params);
}

scope.onmessage = (event) => {
  if (client === null) {
    const port = event.ports[0];
    if (!port) return;
    const active = createPluginClient(port);
    client = active;
    active.onHostRequest((method) => {
      if (method === "health.check") return "pong";
      throw new Error(`No handler for ${method}`);
    });
    scope.postMessage(PLUGIN_READY_MESSAGE);
    return;
  }
  const message = event.data as HarnessCall;
  if (message.kind !== "maibuk:harness-call") return;
  invoke(client, message.path, message.params).then(
    (value) =>
      scope.postMessage({ kind: "maibuk:harness-result", id: message.id, ok: true, value }),
    (error: unknown) => {
      const typed = error as PluginApiError;
      scope.postMessage({
        kind: "maibuk:harness-result",
        id: message.id,
        ok: false,
        code: typed.code ?? null,
        message: typed.message ?? String(error),
      });
    }
  );
};
