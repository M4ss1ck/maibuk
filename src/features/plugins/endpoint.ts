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
 * from the installed manifests and the device's approvals — a Plugin that is
 * enabled and holds `serve` keeps the port bound whether or not its Worker is
 * running — and asks the platform adapter to bind, unbind, or replace the set
 * whenever it changes, recording the listener's state in the Plugin management
 * store.
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
import { base64ToBytes } from "@/plugin-sdk/protocol";

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

/** The port a Plugin's Endpoint address depends on, or null while the listener is not bound. */
export function boundEndpointPort(state: EndpointListenerState): number | null {
  return state.state === "listening" ? state.port : null;
}

/**
 * The address one Plugin answers on (#587). The port belongs to Maibuk, so a
 * move shows up as a different string with no "moved" state kept anywhere.
 */
export function endpointUrlFor(state: EndpointListenerState, pluginId: string): string | null {
  const port = boundEndpointPort(state);
  return port === null ? null : `http://127.0.0.1:${port}/plugin/${pluginId}/`;
}

/** Answers the caller 404: no Plugin is serving this path (or may not). */
function notFound(sink: PluginEndpointSink): void {
  sink.respond(404, [], undefined, false);
}

/** Joins a streamed answer's pieces into the one body the answer carries. */
function joinBytes(pieces: readonly Uint8Array[]): Uint8Array {
  const joined = new Uint8Array(pieces.reduce((total, piece) => total + piece.length, 0));
  let offset = 0;
  for (const piece of pieces) {
    joined.set(piece, offset);
    offset += piece.length;
  }
  return joined;
}

/** One complete Endpoint answer, as a host that only sees the sink's calls collects it. */
export interface CollectedEndpointAnswer {
  status: number;
  /** Response headers, duplicates kept in order. */
  headers: [string, string][];
  /** The whole body: the answer's own bytes, or every streamed chunk joined. */
  body: Uint8Array;
  /** The streamed pieces in order; empty when the Plugin did not stream. */
  chunks: Uint8Array[];
  /** Whether the Plugin answered with a stream, which was waited out. */
  streamed: boolean;
}

/**
 * Runs one Endpoint request through `run` and resolves with the answer it
 * produced: a streamed answer settles on its `end`, a whole one on its reply.
 * The bytes stay apart as `chunks` (a text reader must decode them with one
 * streaming decoder, a multibyte character can straddle two), beside the whole
 * body joined in order.
 */
export function collectEndpointAnswer(
  run: (sink: PluginEndpointSink) => void
): Promise<CollectedEndpointAnswer> {
  return new Promise((resolve) => {
    let status = 0;
    let headers: [string, string][] = [];
    let streamed = false;
    const chunks: Uint8Array[] = [];
    let whole: Uint8Array = new Uint8Array();
    let settled = false;

    function settle() {
      if (settled) return;
      settled = true;
      resolve({ status, headers, body: streamed ? joinBytes(chunks) : whole, chunks, streamed });
    }

    run({
      respond(nextStatus, nextHeaders, body, nextStreaming) {
        status = nextStatus;
        headers = nextHeaders;
        streamed = nextStreaming;
        if (nextStreaming) return;
        whole = body === undefined ? new Uint8Array() : base64ToBytes(body);
        settle();
      },
      chunk(chunk) {
        chunks.push(base64ToBytes(chunk));
        return true;
      },
      end() {
        settle();
      },
    });
  });
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

/**
 * The installed manifest of a Plugin: the lifecycle's entry for it, which
 * outlives the Plugin's runtime, so a serve Plugin that is stopped still holds
 * the port. A Plugin the launch scan never accepted has none.
 */
function installedManifest(pluginId: string): PluginManifest | null {
  const lifecycle = getPluginLifecycle();
  if (!lifecycle) return null;
  return lifecycle.installed().find((plugin) => plugin.pluginId === pluginId)?.manifest ?? null;
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
  /**
   * The installed manifest of a Plugin, running or not; defaults to the
   * lifecycle's installed list, which keeps a stopped Plugin's manifest.
   */
  manifest?: (pluginId: string) => PluginManifest | null;
  /** Calls `listener` whenever the serving set may have changed; returns unsubscribe. */
  subscribe?: (listener: () => void) => () => void;
  /** Records the listener's latest state; defaults to the Plugin management store. */
  record?: (state: EndpointListenerState) => void;
  /** Logs a failed listener; defaults to `console.error`. */
  log?: (message: string, details?: unknown) => void;
}

/**
 * The app's Endpoint supervisor. Derives `enabled ∧ granted serve ∧ installed
 * manifest declares serve` from the approvals and the lifecycle's installed
 * list — a running Worker is not required, so the port follows enablement, not
 * a Worker that idles — calls `adapter.sync` on every change of that set (an
 * identical set is skipped, and an empty one is sent once so the listener
 * unbinds), routes each inbound request through {@link dispatchEndpointRequest}
 * (which answers 404 for a Plugin that is not running), and records the
 * listener's state. Returns the stop that unsubscribes and unbinds.
 */
export function startPluginEndpoint(options: PluginEndpointSupervisorOptions = {}): () => void {
  const runtimeFor =
    options.runtime ?? ((pluginId: string) => getPluginLifecycle()?.runtime(pluginId) ?? null);
  const approvalFor = options.approval ?? getPluginApproval;
  const approvals = options.approvals ?? listPluginApprovals;
  const manifestFor = options.manifest ?? installedManifest;
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
      const manifest = manifestFor(approval.pluginId);
      if (!manifest || !declaresServe(manifest)) continue;
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
 * The live change signal: the management store reports every approval or
 * enable change, so a disable or a revoke unbinds the port even though no
 * runtime stops, and the lifecycle reports every start and stop, which never
 * changes the serving set but does change whether a request answers.
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
