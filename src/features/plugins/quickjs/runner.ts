/**
 * The QuickJS Plugin runner (#516, ADR 0019): the main seam. It evaluates a
 * Plugin's verified module graph in a memory-capped QuickJS engine with the
 * Android global set, replays the init event into the VM, drains pending jobs
 * after every host message and timer callback, and reports ready, error, or
 * memory death. The same runner works unchanged in the sandbox Worker, in
 * Node, and in Vitest.
 *
 * It imports no DOM-only code.
 */

import quickJsVariant from "@jitl/quickjs-ng-wasmfile-release-sync";
import {
  newQuickJSWASMModuleFromVariant,
  newVariant,
  type QuickJSContext,
  type QuickJSHandle,
  type QuickJSRuntime,
} from "quickjs-emscripten-core";
import {
  installPortBridge,
  toVmValue,
  type QuickJsPortBridge,
} from "@/features/plugins/quickjs/bridge";
import {
  QUICKJS_HEAP_CAP_BYTES,
  QUICKJS_MEMORY_DEATH_MARGIN_BYTES,
  QUICKJS_WASM_INITIAL_PAGES,
  quickJsWasmMaximumPages,
} from "@/features/plugins/quickjs/constants";
import { installQuickJsGlobals, type QuickJsGlobalsHost } from "@/features/plugins/quickjs/globals";

/** The Worker global scope, or a test double. */
export interface QuickJsPluginEndpoint {
  postMessage(data: unknown): void;
  addEventListener(
    type: "message",
    listener: (event: { data: unknown; ports: readonly MessagePort[] }) => void
  ): void;
}

/** A scope `message` event: the init replay and every host message. */
export interface QuickJsScopeEvent {
  data: unknown;
  ports: readonly MessagePort[];
}

export interface QuickJsRunOptions {
  /** Verified module sources keyed by Plugin-relative path. */
  sources: Readonly<Record<string, string>>;
  /** The key in `sources` to evaluate first. */
  entry: string;
  endpoint: QuickJsPluginEndpoint;
  /** The QuickJS heap cap; defaults to `QUICKJS_HEAP_CAP_BYTES`. */
  memoryCapBytes?: number;
  /**
   * The raw QuickJS Wasm bytes, compiled here inside the Worker. The host sends
   * bytes, not a `WebAssembly.Module`: a Module posted into the opaque-origin
   * sandbox frame is silently dropped (#516).
   */
  wasmBinary?: ArrayBuffer;
  /**
   * A Wasm module precompiled elsewhere; Node and Vitest may pass it. Wins over
   * `wasmBinary` when both are set.
   */
  wasmModule?: WebAssembly.Module;
  /** Replayed into the VM after evaluation, exactly as the prelude does. */
  initEvent?: QuickJsScopeEvent;
  /** Called once when the Plugin dies of memory, before the outcome settles. */
  onMemoryDeath?: () => void;
}

export type QuickJsRunOutcome =
  | { kind: "ready" }
  | { kind: "error"; message: string }
  | { kind: "memory-death" };

export interface QuickJsPluginRun {
  outcome: Promise<QuickJsRunOutcome>;
  startMs: number;
  dispose(): void;
}

/** A missing module in the graph, so the loader turns it into a setup error. */
function unknownModuleError(name: string): Error {
  return new Error(`Unknown Plugin module: ${name}`);
}

/** The graph keys are Plugin-relative POSIX paths; QuickJS drops a leading "./". */
function normalizeModuleKey(path: string): string {
  return path.startsWith("./") ? path.slice(2) : path;
}

/** The message of a dumped QuickJS error. */
function errorMessageOf(dumped: unknown): string {
  if (typeof dumped === "string") return dumped;
  if (dumped !== null && typeof dumped === "object") {
    const message = (dumped as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return String(dumped);
}

/** True when a message is QuickJS's own out-of-memory. */
function isMemoryDeathMessage(message: string): boolean {
  return /out of memory/i.test(message);
}

/** True when an error thrown on the host side is a Wasm memory-growth abort. */
function isMemoryDeathError(error: unknown): boolean {
  if (error instanceof WebAssembly.RuntimeError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return isMemoryDeathMessage(message);
}

interface TimerEntry {
  handle: QuickJSHandle;
  hostTimer: ReturnType<typeof setTimeout>;
}

function unref(timer: ReturnType<typeof setTimeout>): void {
  const ref = timer as { unref?: () => void };
  if (typeof ref.unref === "function") ref.unref();
}

/**
 * Run one Plugin in its own QuickJS engine. The returned `outcome` settles with
 * `ready`, `error`, or `memory-death`; `dispose()` tears the engine down and
 * stops every timer and delivery, and is safe to call more than once.
 */
export function runQuickJsPlugin(options: QuickJsRunOptions): QuickJsPluginRun {
  const memoryCapBytes = options.memoryCapBytes ?? QUICKJS_HEAP_CAP_BYTES;
  const startMs = Date.now();
  const lookup = new Map<string, string>();
  for (const [path, source] of Object.entries(options.sources)) {
    lookup.set(normalizeModuleKey(path), source);
  }

  let disposed = false;
  let memoryDeathHandled = false;
  let outcomeSettled = false;
  let settleOutcome: (outcome: QuickJsRunOutcome) => void = () => {};
  const outcome = new Promise<QuickJsRunOutcome>((resolve) => {
    settleOutcome = (value) => {
      if (outcomeSettled) return;
      outcomeSettled = true;
      resolve(value);
    };
  });

  let runtime: QuickJSRuntime | null = null;
  let context: QuickJSContext | null = null;
  let scopeDispatch: QuickJSHandle | null = null;
  let bridge: QuickJsPortBridge | null = null;
  let nextTimerId = 1;
  let nextPortId = 1;
  const timers = new Map<number, TimerEntry>();
  const hostPorts = new Map<number, MessagePort>();

  function cancelTimer(id: number): void {
    const entry = timers.get(id);
    if (!entry) return;
    timers.delete(id);
    clearTimeout(entry.hostTimer);
    clearInterval(entry.hostTimer);
    if (entry.handle.alive) entry.handle.dispose();
  }

  function detach(): void {
    for (const id of [...timers.keys()]) cancelTimer(id);
    for (const port of hostPorts.values()) {
      try {
        port.onmessage = null;
      } catch {
        // A closed port refuses a new handler; nothing left to detach.
      }
    }
    hostPorts.clear();
    if (scopeDispatch !== null && scopeDispatch.alive) scopeDispatch.dispose();
    scopeDispatch = null;
    if (context !== null) {
      try {
        context.dispose();
      } catch {
        // Already gone with the runtime.
      }
      context = null;
    }
    if (runtime !== null) {
      try {
        runtime.dispose();
      } catch {
        // Already gone.
      }
      runtime = null;
    }
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    detach();
  }

  function dieOfMemory(): void {
    if (memoryDeathHandled) return;
    memoryDeathHandled = true;
    dispose();
    options.onMemoryDeath?.();
    settleOutcome({ kind: "memory-death" });
  }

  function reportError(message: string): void {
    if (outcomeSettled) return;
    dispose();
    settleOutcome({ kind: "error", message });
  }

  /**
   * Read a QuickJS error handle and decide whether the run died of memory. An
   * out-of-memory run can leave an error QuickJS cannot dump (its own string
   * allocation failed): `dump` then yields null/undefined/empty, which is a
   * memory death too. The heap cap is lifted first, since the run is already
   * dying, so the dump itself cannot fail the same way.
   */
  function readError(handle: QuickJSHandle): { message: string; memoryDeath: boolean } {
    if (runtime !== null) {
      try {
        runtime.setMemoryLimit(-1);
      } catch {
        // The runtime may already be gone; the dump below still decides.
      }
    }
    let dumped: unknown;
    try {
      dumped = context === null ? undefined : context.dump(handle);
    } catch {
      dumped = undefined;
    }
    const message = errorMessageOf(dumped);
    const memoryDeath =
      dumped === null ||
      dumped === undefined ||
      message.trim() === "" ||
      isMemoryDeathMessage(message);
    return { message, memoryDeath };
  }

  /**
   * Runs every pending job, one at a time, checking the heap before each one.
   * An out-of-memory raised inside an async function rejects that function's
   * promise, which nothing reports, and the rejection frees the function's locals
   * in the same job: the heap reads low again once the turn ends. The check must
   * run between jobs, while the allocations that exhausted the cap still count.
   */
  function drainJobs(): void {
    runPendingJobs();
  }

  /** The heap usage the engine reports, or null when the run is gone. */
  function heapUsedBytes(): number | null {
    if (runtime === null || context === null) return null;
    const usage = runtime.computeMemoryUsage();
    try {
      const dumped = context.dump(usage);
      if (typeof dumped !== "object" || dumped === null) return null;
      const used = (dumped as { memory_used_size?: unknown }).memory_used_size;
      return typeof used === "number" ? used : null;
    } finally {
      if (usage.alive) usage.dispose();
    }
  }

  function checkHeapWatermark(): void {
    if (disposed || memoryDeathHandled) return;
    const used = heapUsedBytes();
    if (used === null) return;
    if (used >= memoryCapBytes - QUICKJS_MEMORY_DEATH_MARGIN_BYTES) dieOfMemory();
  }

  function runPendingJobs(): void {
    if (disposed || runtime === null || context === null) return;
    for (;;) {
      checkHeapWatermark();
      if (disposed || memoryDeathHandled || runtime === null) return;
      const result = runtime.executePendingJobs(1);
      if (result.error) {
        const { message, memoryDeath } = readError(result.error);
        result.error.dispose();
        if (memoryDeath) {
          dieOfMemory();
        } else {
          reportError(message);
        }
        return;
      }
      if (result.value === 0) return;
      if (disposed || memoryDeathHandled) return;
    }
  }

  function scheduleTimer(callback: QuickJSHandle, delayMs: number, repeat: boolean): number {
    const id = nextTimerId++;
    const fire = () => {
      if (disposed || context === null) return;
      let result: ReturnType<QuickJSContext["callFunction"]>;
      try {
        result = context.callFunction(callback, context.undefined);
      } catch (error) {
        if (isMemoryDeathError(error)) dieOfMemory();
        else reportError(error instanceof Error ? error.message : String(error));
        return;
      }
      if (result.error) {
        const { message, memoryDeath } = readError(result.error);
        result.error.dispose();
        if (memoryDeath) dieOfMemory();
        else reportError(message);
        return;
      }
      if (result.value.alive) result.value.dispose();
      drainJobs();
      if (!repeat) cancelTimer(id);
    };
    const hostTimer = repeat ? setInterval(fire, delayMs) : setTimeout(fire, delayMs);
    unref(hostTimer);
    timers.set(id, { handle: callback, hostTimer });
    return id;
  }

  function registerHostPort(portId: number, port: MessagePort): void {
    hostPorts.set(portId, port);
    port.onmessage = (event) => {
      if (disposed || context === null || bridge === null) return;
      const activeContext = context;
      const activeBridge = bridge;
      const messageEvent = event as MessageEvent;
      const handles = new Map<MessagePort, QuickJSHandle>();
      let dataHandle: QuickJSHandle | null = null;
      let portsHandle: QuickJSHandle | null = null;
      try {
        portsHandle = bridgePortList(activeContext, activeBridge, messageEvent.ports ?? [], handles);
        dataHandle = toVmValue(activeContext, messageEvent.data, (port) =>
          bridgedPortHandle(activeBridge, port, handles)
        );
        activeBridge.deliverPortMessage(portId, dataHandle, portsHandle);
      } catch (error) {
        if (isMemoryDeathError(error)) dieOfMemory();
        else reportError(error instanceof Error ? error.message : String(error));
      } finally {
        if (dataHandle !== null && dataHandle.alive) dataHandle.dispose();
        if (portsHandle !== null && portsHandle.alive) portsHandle.dispose();
        for (const handle of handles.values()) if (handle.alive) handle.dispose();
      }
      drainJobs();
    };
    port.start();
  }

  /** The VM port for one host port, created once per message and reused. */
  function bridgedPortHandle(
    activeBridge: QuickJsPortBridge,
    port: MessagePort,
    handles: Map<MessagePort, QuickJSHandle>
  ): QuickJSHandle {
    const existing = handles.get(port);
    if (existing !== undefined) return existing;
    const portId = nextPortId++;
    registerHostPort(portId, port);
    const handle = activeBridge.createPort(portId);
    handles.set(port, handle);
    return handle;
  }

  /** A VM array of the bridged VM ports for one host message's `ports`. */
  function bridgePortList(
    activeContext: QuickJSContext,
    activeBridge: QuickJsPortBridge,
    ports: readonly MessagePort[],
    handles: Map<MessagePort, QuickJSHandle>
  ): QuickJSHandle {
    const array = activeContext.newArray();
    ports.forEach((port, index) => {
      activeContext.setProp(array, index, bridgedPortHandle(activeBridge, port, handles));
    });
    return array;
  }

  function deliverScopeMessage(event: QuickJsScopeEvent): void {
    if (disposed || context === null || scopeDispatch === null || bridge === null) return;
    const activeContext = context;
    const activeBridge = bridge;
    const handles = new Map<MessagePort, QuickJSHandle>();
    let dataHandle: QuickJSHandle | null = null;
    let portsHandle: QuickJSHandle | null = null;
    let result: ReturnType<QuickJSContext["callFunction"]> | null = null;
    try {
      portsHandle = bridgePortList(activeContext, activeBridge, event.ports, handles);
      dataHandle = toVmValue(activeContext, event.data, (port) =>
        bridgedPortHandle(activeBridge, port, handles)
      );
      result = activeContext.callFunction(scopeDispatch, activeContext.undefined, dataHandle, portsHandle);
    } catch (error) {
      if (isMemoryDeathError(error)) dieOfMemory();
      else reportError(error instanceof Error ? error.message : String(error));
      return;
    } finally {
      if (dataHandle !== null && dataHandle.alive) dataHandle.dispose();
      if (portsHandle !== null && portsHandle.alive) portsHandle.dispose();
      for (const handle of handles.values()) if (handle.alive) handle.dispose();
    }
    if (result === null) return;
    if (result.error) {
      const { message, memoryDeath } = readError(result.error);
      result.error.dispose();
      if (memoryDeath) dieOfMemory();
      else reportError(message);
      return;
    }
    if (result.value.alive) result.value.dispose();
    drainJobs();
  }

  const globalsHost: QuickJsGlobalsHost = {
    postMessage: (value) => options.endpoint.postMessage(value),
    now: () => performance.now(),
    console: (level, args) => {
      console[level](...args);
    },
    setTimer: (callback, delayMs, repeat) => scheduleTimer(callback, delayMs, repeat),
    clearTimer: (id) => cancelTimer(id),
    parseUrl: (input, base) => {
      const url = base === undefined ? new URL(input) : new URL(input, base);
      return {
        href: url.href,
        origin: url.origin,
        protocol: url.protocol,
        username: url.username,
        password: url.password,
        host: url.host,
        hostname: url.hostname,
        port: url.port,
        pathname: url.pathname,
        search: url.search,
        hash: url.hash,
      };
    },
  };

  async function evaluate(): Promise<void> {
    const entryKey = normalizeModuleKey(options.entry);
    const source = lookup.get(entryKey);
    if (source === undefined) {
      reportError(unknownModuleError(entryKey).message);
      return;
    }
    if (context === null || runtime === null) return;
    let result: ReturnType<QuickJSContext["evalCode"]>;
    try {
      result = context.evalCode(source, entryKey, { type: "module" });
    } catch (error) {
      if (isMemoryDeathError(error)) dieOfMemory();
      else reportError(error instanceof Error ? error.message : String(error));
      return;
    }
    if (result.error) {
      const { message, memoryDeath } = readError(result.error);
      result.error.dispose();
      if (memoryDeath) dieOfMemory();
      else reportError(message);
      return;
    }
    await settleTopLevelPromise(result.value);
    if (disposed || memoryDeathHandled) return;
    if (result.value.alive) result.value.dispose();
    drainJobs();
    if (disposed || memoryDeathHandled) return;
    if (options.initEvent) deliverScopeMessage(options.initEvent);
    if (disposed || memoryDeathHandled) return;
    settleOutcome({ kind: "ready" });
  }

  async function settleTopLevelPromise(value: QuickJSHandle): Promise<void> {
    if (context === null) return;
    for (;;) {
      drainJobs();
      if (disposed || memoryDeathHandled || context === null) return;
      const state = context.getPromiseState(value);
      if (state.type === "fulfilled") {
        if (!state.notAPromise && state.value.alive) state.value.dispose();
        return;
      }
      if (state.type === "rejected") {
        const { message, memoryDeath } = readError(state.error);
        state.error.dispose();
        if (memoryDeath) dieOfMemory();
        else reportError(message);
        return;
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 0);
        unref(timer);
      });
    }
  }

  async function start(): Promise<void> {
    let variant: ReturnType<typeof newVariant>;
    try {
      const maximum = quickJsWasmMaximumPages(memoryCapBytes);
      const wasmMemory = new WebAssembly.Memory({
        initial: QUICKJS_WASM_INITIAL_PAGES,
        maximum,
      });
      const wasmModule =
        options.wasmModule ??
        (options.wasmBinary ? await WebAssembly.compile(options.wasmBinary) : undefined);
      if (disposed) return;
      variant = newVariant(quickJsVariant, {
        wasmModule,
        wasmMemory,
      });
    } catch (error) {
      reportError(error instanceof Error ? error.message : String(error));
      return;
    }
    let module: Awaited<ReturnType<typeof newQuickJSWASMModuleFromVariant>>;
    try {
      module = await newQuickJSWASMModuleFromVariant(variant);
    } catch (error) {
      if (isMemoryDeathError(error)) dieOfMemory();
      else reportError(error instanceof Error ? error.message : String(error));
      return;
    }
    if (disposed) return;
    runtime = module.newRuntime();
    runtime.setMemoryLimit(memoryCapBytes);
    context = runtime.newContext();

    try {
      scopeDispatch = installQuickJsGlobals(context, globalsHost);
      bridge = installPortBridge(context, {
        portPostMessage: (portId, value) => {
          hostPorts.get(portId)?.postMessage(value);
        },
        portClose: (portId) => {
          const port = hostPorts.get(portId);
          hostPorts.delete(portId);
          port?.close();
        },
      });
      runtime.setModuleLoader((moduleName) => {
        const key = normalizeModuleKey(moduleName);
        const source = lookup.get(key);
        if (source === undefined) throw unknownModuleError(key);
        return source;
      });
    } catch (error) {
      if (isMemoryDeathError(error)) dieOfMemory();
      else reportError(error instanceof Error ? error.message : String(error));
      return;
    }
    options.endpoint.addEventListener("message", (event) => {
      deliverScopeMessage(event);
    });
    await evaluate();
  }

  void start();

  return { outcome, startMs, dispose };
}
