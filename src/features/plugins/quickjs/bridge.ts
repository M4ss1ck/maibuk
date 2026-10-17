/**
 * The QuickJS port bridge (#516): the host `MessagePort`s a Plugin receives
 * (the SDK init port, every Remote UI mount's transferred port, and every
 * Frame port) become VM objects with `postMessage`, `onmessage`,
 * `addEventListener`, `removeEventListener`, `start()`, and `close()`. Data
 * crosses by structured value, never by sharing a handle: a VM
 * `postMessage(data)` is dumped and forwarded to the real port, and a message
 * the real port receives is rebuilt as a VM value and delivered to the VM
 * port's `onmessage` (or to its `message` listeners).
 *
 * The VM side is a small shim so `onmessage` assignment is observed exactly as
 * a Worker observes it. This module imports no DOM-only code.
 */

import type { QuickJSContext, QuickJSHandle } from "quickjs-emscripten-core";

/** The host end of the bridge: where a VM port's calls go. */
export interface QuickJsBridgeHost {
  /** A VM port called `postMessage`; forward the dumped value to the real port. */
  portPostMessage(portId: number, value: unknown): void;
  /** A VM port called `close()`. */
  portClose(portId: number): void;
}

/** The VM functions the runner drives to hand ports to and messages into a Plugin. */
export interface QuickJsPortBridge {
  /** Create (and register) the VM port object for one real host port. */
  createPort(portId: number): QuickJSHandle;
  /** Deliver one host message to the VM port's `onmessage` or `message` listeners. */
  deliverPortMessage(portId: number, data: QuickJSHandle, ports: QuickJSHandle): void;
}

/**
 * True for a real `MessagePort`. Duck-typed, not `instanceof`: the port crosses
 * from the host realm (a jsdom or Worker `MessagePort`) and a transferred port
 * referenced inside message data must be recognised wherever it appears.
 */
export function isMessagePort(value: unknown): value is MessagePort {
  if (typeof value !== "object" || value === null) return false;
  const port = value as MessagePort;
  return (
    typeof port.postMessage === "function" &&
    typeof port.start === "function" &&
    typeof port.close === "function"
  );
}

/**
 * Convert a structured-cloneable host value into a QuickJS handle. This is the
 * `newValue` half of "data crosses by structured value": strings, numbers,
 * booleans, null, undefined, arrays, plain objects, ArrayBuffers, and typed
 * arrays cross; anything else becomes `undefined` rather than sharing a handle.
 *
 * A `MessagePort` cannot cross as a value: `portValue` (when given) turns one
 * into the bridged VM port, so a Remote UI mount's transferred port — which
 * arrives both in `event.ports` and nested in the request's `params.port` — is
 * the same VM object either way.
 */
export function toVmValue(
  context: QuickJSContext,
  value: unknown,
  portValue?: (port: MessagePort) => QuickJSHandle
): QuickJSHandle {
  if (portValue !== undefined && isMessagePort(value)) return portValue(value);
  if (value === undefined) return context.undefined;
  if (value === null) return context.null;
  switch (typeof value) {
    case "boolean":
      return value ? context.true : context.false;
    case "number":
      return context.newNumber(value);
    case "string":
      return context.newString(value);
    case "bigint":
      return context.newBigInt(value);
    case "object":
      break;
    default:
      return context.undefined;
  }
  if (Array.isArray(value)) {
    const array = context.newArray();
    value.forEach((item, index) => {
      const itemHandle = toVmValue(context, item, portValue);
      context.setProp(array, index, itemHandle);
      if (itemHandle.alive) itemHandle.dispose();
    });
    return array;
  }
  if (value instanceof ArrayBuffer) {
    return context.newArrayBuffer(value);
  }
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    return context.newArrayBuffer(bytes.slice().buffer);
  }
  const object = context.newObject();
  for (const [key, item] of Object.entries(value)) {
    const itemHandle = toVmValue(context, item, portValue);
    context.setProp(object, key, itemHandle);
    if (itemHandle.alive) itemHandle.dispose();
  }
  return object;
}

/**
 * The VM port shim. `Port` keeps `onmessage` as an ordinary property so
 * assigning it reads back exactly like a Worker `MessagePort`; the runner's
 * delivery calls back into it through `deliver`.
 */
const BRIDGE_SOURCE = `(function () {
  "use strict";
  var host = globalThis.__maibukBridgeHost;
  var registry = new Map();

  function Port(id) {
    this.__id = id;
    this.onmessage = null;
    this.__listeners = new Set();
    this.__started = false;
  }
  Port.prototype.postMessage = function (data) {
    host.portPostMessage(this.__id, data);
  };
  Port.prototype.start = function () {
    this.__started = true;
  };
  Port.prototype.close = function () {
    host.portClose(this.__id);
    registry.delete(this.__id);
  };
  Port.prototype.addEventListener = function (type, listener) {
    if (type === "message" && typeof listener === "function") this.__listeners.add(listener);
  };
  Port.prototype.removeEventListener = function (type, listener) {
    if (type === "message") this.__listeners.delete(listener);
  };

  globalThis.__maibukQuickJsPorts = {
    create: function (id) {
      var port = new Port(id);
      registry.set(id, port);
      return port;
    },
    deliver: function (id, data, ports) {
      var port = registry.get(id);
      if (!port) return;
      var event = { type: "message", data: data, ports: ports || [] };
      var handler = port.onmessage;
      if (typeof handler === "function") {
        handler.call(port, event);
        return;
      }
      var listeners = Array.from(port.__listeners);
      for (var i = 0; i < listeners.length; i++) listeners[i].call(port, event);
    },
  };
})();`;

/**
 * Install the port bridge on a fresh context and return the handles the runner
 * drives. Host ports must already be registered under their `portId` before a
 * message is delivered for them.
 */
export function installPortBridge(
  context: QuickJSContext,
  host: QuickJsBridgeHost
): QuickJsPortBridge {
  const hostObject = context.newObject();
  const portPostMessage = context.newFunction("portPostMessage", (idHandle, dataHandle) => {
    host.portPostMessage(context.getNumber(idHandle), context.dump(dataHandle));
  });
  const portClose = context.newFunction("portClose", (idHandle) => {
    host.portClose(context.getNumber(idHandle));
  });
  context.setProp(hostObject, "portPostMessage", portPostMessage);
  context.setProp(hostObject, "portClose", portClose);
  portPostMessage.dispose();
  portClose.dispose();
  context.setProp(context.global, "__maibukBridgeHost", hostObject);
  hostObject.dispose();

  const installed = context.evalCode(BRIDGE_SOURCE);
  if (installed.error) {
    const dumped = context.dump(installed.error) as { message?: unknown } | string;
    installed.error.dispose();
    throw new Error(
      typeof dumped === "string" ? dumped : String(dumped?.message ?? "port bridge install failed")
    );
  }
  installed.value.dispose();

  function readBridgeFunction(name: string): QuickJSHandle {
    const ports = context.getProp(context.global, "__maibukQuickJsPorts");
    const fn = context.getProp(ports, name);
    ports.dispose();
    return fn;
  }

  return {
    createPort(portId: number): QuickJSHandle {
      const create = readBridgeFunction("create");
      const idHandle = context.newNumber(portId);
      const result = context.callFunction(create, context.undefined, idHandle);
      create.dispose();
      idHandle.dispose();
      if (result.error) {
        const dumped = context.dump(result.error) as { message?: unknown } | string;
        result.error.dispose();
        throw new Error(
          typeof dumped === "string" ? dumped : String(dumped?.message ?? "createPort failed")
        );
      }
      return result.value;
    },
    deliverPortMessage(portId: number, data: QuickJSHandle, ports: QuickJSHandle): void {
      const deliver = readBridgeFunction("deliver");
      const idHandle = context.newNumber(portId);
      const result = context.callFunction(deliver, context.undefined, idHandle, data, ports);
      deliver.dispose();
      idHandle.dispose();
      if (!result.error && result.value.alive) result.value.dispose();
      if (result.error) {
        const dumped = context.dump(result.error) as { message?: unknown } | string;
        result.error.dispose();
        throw new Error(
          typeof dumped === "string"
            ? dumped
            : String(dumped?.message ?? "deliverPortMessage failed")
        );
      }
    },
  };
}
