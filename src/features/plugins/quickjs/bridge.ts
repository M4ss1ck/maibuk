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
  /** A VM port called `postMessage`; forward the value it posted to the real port. */
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
 * The VM half of "marshalling out": what a Plugin posts has to survive its way
 * to the host, and QuickJS has no structured clone, so the host receives a JSON
 * pass (`dump`). A JSON pass has no binary form: an `ArrayBuffer` dumps as `{}`
 * and a typed array as an object of indices, which is how every archive image
 * reached the Reader Frame as a zero-length buffer while a string entry
 * arrived whole. This encoder runs the same JSON pass with a replacer that lifts
 * each `ArrayBuffer` and view into a list, leaving a marker where it sat;
 * {@link fromVmValue} puts those bytes back from that list.
 */
const OUT_ENCODER_SOURCE = `(function () {
  if (typeof globalThis.__maibukEncodeOut === "function") return;
  globalThis.__maibukEncodeOut = function (value) {
    var buffers = [];
    var json = JSON.stringify(value, function (key, held) {
      if (held instanceof ArrayBuffer) {
        buffers.push(held);
        return { __maibukBytes: buffers.length - 1 };
      }
      if (ArrayBuffer.isView(held)) {
        // A view carries only its own bytes: its buffer may hold data the
        // message never included.
        buffers.push(new Uint8Array(held.buffer, held.byteOffset, held.byteLength).slice().buffer);
        return { __maibukBytes: buffers.length - 1, __maibukView: held.constructor.name };
      }
      return held;
    });
    return { json: json, buffers: buffers };
  };
})();`;

/** The marker key the encoder writes where an `ArrayBuffer` or view sat. */
const BYTES_KEY = "__maibukBytes";
/** The marker key naming a view's own type, so it comes back as that view. */
const VIEW_KEY = "__maibukView";

/** Every view type a message may carry, rebuilt from its bytes on the host. */
const VIEW_TYPES = new Map<string, new (buffer: ArrayBuffer) => ArrayBufferView>([
  ["DataView", DataView],
  ["Int8Array", Int8Array],
  ["Uint8Array", Uint8Array],
  ["Uint8ClampedArray", Uint8ClampedArray],
  ["Int16Array", Int16Array],
  ["Uint16Array", Uint16Array],
  ["Int32Array", Int32Array],
  ["Uint32Array", Uint32Array],
  ["Float32Array", Float32Array],
  ["Float64Array", Float64Array],
  ["BigInt64Array", BigInt64Array],
  ["BigUint64Array", BigUint64Array],
]);

/**
 * Install the encoder the port and scope `postMessage` shims call. Idempotent:
 * the VM keeps the first one, so both shims can ensure it before use.
 */
export function installOutEncoder(context: QuickJSContext): void {
  const installed = context.evalCode(OUT_ENCODER_SOURCE);
  if (installed.error) {
    const dumped = context.dump(installed.error) as { message?: unknown } | string;
    installed.error.dispose();
    throw new Error(
      typeof dumped === "string" ? dumped : String(dumped?.message ?? "encoder install failed")
    );
  }
  installed.value.dispose();
}

/**
 * Convert one value the encoder returned — `{ json, buffers }` — back into a
 * host value, with each marker replaced by its bytes. This is the `dump` half
 * of "data crosses by structured value": strings, numbers, booleans, null,
 * arrays, and plain objects arrive as they were posted, `ArrayBuffer`s arrive
 * as `ArrayBuffer`s, and views arrive as their own type.
 */
export function fromVmValue(context: QuickJSContext, encoded: QuickJSHandle): unknown {
  const jsonHandle = context.getProp(encoded, "json");
  const buffersHandle = context.getProp(encoded, "buffers");
  try {
    // `JSON.stringify` answers undefined for a value it cannot encode at all.
    if (context.typeof(jsonHandle) === "undefined") return undefined;
    const parsed: unknown = JSON.parse(context.getString(jsonHandle));
    return reviveBytes(parsed, readBuffers(context, buffersHandle));
  } finally {
    jsonHandle.dispose();
    buffersHandle.dispose();
  }
}

/**
 * The most buffers one message may carry. The encoder lifts one buffer per
 * marker in the JSON, so a real message never comes close; a forged `buffers`
 * with a length in the billions would otherwise make the host loop once per
 * claimed entry, outside the VM's CPU budget and its heap cap.
 */
const MAX_MESSAGE_BUFFERS = 4096;

/** What a `buffers` entry that is not an ArrayBuffer refuses with. */
const NOT_A_BUFFER = "A Plugin message's buffers must be ArrayBuffers";

/** Copy one `buffers` entry the VM produced. */
function copyBuffer(context: QuickJSContext, item: QuickJSHandle): ArrayBuffer {
  // A forged message can put anything under `buffers`; `getArrayBuffer` only
  // makes sense on an ArrayBuffer, and the encoder writes nothing else.
  if (context.typeof(item) !== "object") throw new Error(NOT_A_BUFFER);
  let copied: ReturnType<QuickJSContext["getArrayBuffer"]>;
  try {
    copied = context.getArrayBuffer(item);
  } catch {
    throw new Error(NOT_A_BUFFER);
  }
  try {
    // `getArrayBuffer` hands back a view of the Wasm heap the lifetime frees;
    // the slice is this message's own copy.
    return copied.value.slice().buffer as ArrayBuffer;
  } finally {
    copied.dispose();
  }
}

/** Copy each buffer the encoder lifted out of the VM. */
function readBuffers(context: QuickJSContext, handle: QuickJSHandle): ArrayBuffer[] {
  // Read the array's own `length` property. `context.getLength` reads a
  // `Uint32Array` cached over the Wasm heap when the context was created; a
  // growing heap detaches that view, the read answers undefined, and every
  // buffer in the message vanished (#516).
  const lengthHandle = context.getProp(handle, "length");
  let length: number;
  try {
    length = context.getNumber(lengthHandle);
  } finally {
    lengthHandle.dispose();
  }
  if (!Number.isInteger(length) || length < 0) return [];
  if (length > MAX_MESSAGE_BUFFERS) {
    throw new Error(`A Plugin message may carry at most ${MAX_MESSAGE_BUFFERS} buffers`);
  }
  const buffers: ArrayBuffer[] = [];
  for (let index = 0; index < length; index += 1) {
    const item = context.getProp(handle, index);
    try {
      buffers.push(copyBuffer(context, item));
    } finally {
      // Released even when the entry is refused: the VM's `postMessage` ends in
      // a thrown exception, and a leaked handle would hold its value until the
      // run ends.
      item.dispose();
    }
  }
  return buffers;
}

/** Replace every bytes marker in the dumped value with its bytes. */
function reviveBytes(value: unknown, buffers: readonly ArrayBuffer[]): unknown {
  if (Array.isArray(value)) return value.map((item) => reviveBytes(item, buffers));
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  const index = record[BYTES_KEY];
  if (typeof index === "number" && Number.isInteger(index)) {
    const buffer = buffers[index];
    if (buffer !== undefined) {
      const kind = record[VIEW_KEY];
      const View = typeof kind === "string" ? VIEW_TYPES.get(kind) : undefined;
      return View === undefined ? buffer : new View(buffer);
    }
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record)) out[key] = reviveBytes(item, buffers);
  return out;
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
    host.portPostMessage(this.__id, globalThis.__maibukEncodeOut(data));
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
  installOutEncoder(context);
  const hostObject = context.newObject();
  const portPostMessage = context.newFunction("portPostMessage", (idHandle, dataHandle) => {
    host.portPostMessage(context.getNumber(idHandle), fromVmValue(context, dataHandle));
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
