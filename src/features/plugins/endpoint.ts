/**
 * The Plugin Endpoint's host side (#586): routes one inbound HTTP request to
 * the Plugin its path named, and keeps the listener's serving set in step with
 * the Plugins that may actually answer.
 *
 * `dispatchEndpointRequest` is platform-independent and has no socket in it: a
 * request reaches a Plugin only when it is running, enabled, and both declares
 * and was granted the `serve` Plugin Permission; anything else is answered 404
 * by the host, so a request never reaches the wrong Plugin and a revoked grant
 * stops new requests without a restart. The supervisor derives the serving set
 * from the same live sources — the lifecycle's runtimes and the device's
 * approvals — and asks the platform adapter to bind, unbind, or replace the
 * set whenever it changes, recording the listener's state in the Plugin
 * management store.
 */

import { getPluginApproval, listPluginApprovals } from "@/features/plugins/approvals";
import { getPluginLifecycle } from "@/features/plugins/lifecycle-instance";
import { usePluginManagementStore } from "@/features/plugins/management";
import type {
  EndpointListenerState,
  EndpointRequestMessage,
  PluginApproval,
  PluginEndpointSink,
  PluginManifest,
  PluginRuntime,
} from "@/features/plugins/types";
import { getPluginEndpoint } from "@/lib/platform";
import type { EndpointAdapter } from "@/lib/platform/types";

/** The live lookups one Endpoint request is routed with; injected by tests. */
export interface EndpointDispatchDeps {
  /** The Plugin's running runtime, or null when it is not running. */
  runtime(pluginId: string): PluginRuntime | null;
  /** The Plugin's approval now, or null when it was never approved. */
  approval(pluginId: string): PluginApproval | null;
}

/** True when the manifest declares the `serve` Plugin Permission, required or optional. */
function declaresServe(manifest: PluginManifest): boolean {
  const { required, optional } = manifest.permissions;
  return required.includes("serve") || optional.includes("serve");
}

/** Answers the caller 404: no Plugin is serving this path (or may not). */
function notFound(sink: PluginEndpointSink): void {
  sink.respond(404, [], undefined, false);
}

/**
 * Delivers one Endpoint request to exactly the Plugin its path named: the
 * running runtime's broker when the Plugin is enabled and holds `serve`, a 404
 * otherwise. The broker re-reads the grant once more, so a revoke racing this
 * call still refuses.
 */
export function dispatchEndpointRequest(
  deps: EndpointDispatchDeps,
  message: EndpointRequestMessage,
  sink: PluginEndpointSink
): void {
  const runtime = deps.runtime(message.pluginId);
  if (!runtime) {
    notFound(sink);
    return;
  }
  const approval = deps.approval(message.pluginId);
  if (!approval?.enabled || !approval.granted.includes("serve")) {
    notFound(sink);
    return;
  }
  if (!declaresServe(runtime.manifest)) {
    notFound(sink);
    return;
  }
  runtime.broker.requestEndpoint(message.request, sink);
}

/** What the supervisor can be built with; every field defaults to the app's live source. */
export interface PluginEndpointSupervisorOptions {
  /** The platform listener; defaults to this build's adapter. */
  adapter?: EndpointAdapter;
  /** The running runtime for a Plugin id; defaults to the app's lifecycle. */
  runtime?: (pluginId: string) => PluginRuntime | null;
  /** The Plugin's approval now; defaults to the device's approval record. */
  approval?: (pluginId: string) => PluginApproval | null;
  /** Every approved Plugin, running or not; defaults to the device's approvals. */
  approvals?: () => readonly PluginApproval[];
  /** Calls `listener` whenever the serving set may have changed; returns unsubscribe. */
  subscribe?: (listener: () => void) => () => void;
  /** Records the listener's latest state; defaults to the Plugin management store. */
  record?: (state: EndpointListenerState) => void;
  /** Logs a failed listener; defaults to `console.error`. */
  log?: (message: string, details?: unknown) => void;
}

/**
 * The app's Endpoint supervisor. Derives `running ∧ enabled ∧ granted serve`
 * from the lifecycle's runtimes and the approvals, calls `adapter.sync` on
 * every change of that set (an identical set is skipped, and an empty one is
 * sent once so the listener unbinds), routes each inbound request through
 * {@link dispatchEndpointRequest}, and records the listener's state. Returns
 * the stop that unsubscribes and unbinds.
 */
export function startPluginEndpoint(options: PluginEndpointSupervisorOptions = {}): () => void {
  const runtimeFor =
    options.runtime ?? ((pluginId: string) => getPluginLifecycle()?.runtime(pluginId) ?? null);
  const approvalFor = options.approval ?? getPluginApproval;
  const approvals = options.approvals ?? listPluginApprovals;
  const record =
    options.record ??
    ((state: EndpointListenerState) => usePluginManagementStore.getState().setEndpoint(state));
  const log =
    options.log ??
    ((message: string, details?: unknown) => console.error(`[plugins] ${message}`, details));
  const subscribe = options.subscribe ?? defaultSubscribe;

  let adapter: EndpointAdapter | null = options.adapter ?? null;
  let stopped = false;
  /** The set last handed to `sync`, so an unchanged set costs no IPC. */
  let lastKey: string | null = null;
  let chain: Promise<void> = Promise.resolve();

  function servingIds(): string[] {
    const ids: string[] = [];
    for (const approval of approvals()) {
      if (!approval.enabled) continue;
      if (!approval.granted.includes("serve")) continue;
      const runtime = runtimeFor(approval.pluginId);
      if (!runtime || !declaresServe(runtime.manifest)) continue;
      ids.push(approval.pluginId);
    }
    return ids.sort();
  }

  /** Routes one inbound request through the dispatcher, with the adapter as its sink. */
  function deliver(message: EndpointRequestMessage): void {
    const target = adapter;
    if (stopped || !target) return;
    const failed = (what: string) => (error: unknown) =>
      log(`Plugin Endpoint could not ${what} ${message.requestId}`, error);
    dispatchEndpointRequest({ runtime: runtimeFor, approval: approvalFor }, message, {
      respond: (status, headers, body, streaming) => {
        void target
          .respond(message.requestId, status, headers, body, streaming)
          .catch(failed("answer"));
      },
      chunk: (chunk) => target.chunk(message.requestId, chunk),
      end: () => {
        void target.end(message.requestId).catch(failed("end"));
      },
    });
  }

  async function runSync(): Promise<void> {
    if (stopped) return;
    const ids = servingIds();
    const key = ids.join("\n");
    if (key === lastKey) return;
    lastKey = key;
    try {
      adapter ??= await (options.adapter ?? getPluginEndpoint());
      if (stopped) return;
      const state = await adapter.sync(ids, deliver);
      if (stopped) return;
      record(state);
      if (state.state === "failed") {
        log(`Plugin Endpoint failed to listen on 127.0.0.1:${state.port}: ${state.reason}`);
      }
    } catch (error) {
      // Let a later change retry the same set.
      lastKey = null;
      throw error;
    }
  }

  function schedule(): void {
    chain = chain.then(runSync).catch((error) => {
      log("Plugin Endpoint could not sync the listener", error);
    });
  }

  schedule();
  const unsubscribe = subscribe(schedule);

  return () => {
    if (stopped) return;
    stopped = true;
    unsubscribe();
    const current = adapter;
    if (current) {
      // Unbind, so a closed host leaves no socket answering.
      void current
        .sync([], () => {})
        .catch((error) => {
          log("Plugin Endpoint could not unbind", error);
        });
    }
  };
}

/**
 * The live change signal: the lifecycle reports every start and stop, and the
 * management store reports every approval or enable change that leaves a
 * Plugin running (revoking an optional grant changes no runtime).
 */
function defaultSubscribe(listener: () => void): () => void {
  const lifecycle = getPluginLifecycle();
  const offLifecycle = lifecycle?.subscribe(() => listener()) ?? (() => {});
  const offStore = usePluginManagementStore.subscribe((state, previous) => {
    if (state.plugins !== previous.plugins) listener();
  });
  return () => {
    offLifecycle();
    offStore();
  };
}
