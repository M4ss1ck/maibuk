/**
 * The Android global set for the QuickJS Plugin engine (#516, ADR 0019):
 * exactly `setTimeout`, `clearTimeout`, `setInterval`, `clearInterval`,
 * `queueMicrotask`, `performance.now`, `URL`, `TextEncoder`, `TextDecoder`,
 * `console`, plus the `self`/`globalThis` worker-scope bridge (`postMessage`,
 * `onmessage`, `addEventListener`, `removeEventListener`). `Intl` and
 * `WebAssembly` are absent.
 *
 * What a Plugin actually needs from the host (real timers, the scope's
 * `postMessage`, `console`, `performance.now`, and URL parsing, which QuickJS
 * has no built-in for) crosses as host functions; everything else is a small
 * VM shim. This module imports no DOM-only code.
 */

import type { QuickJSContext, QuickJSHandle } from "quickjs-emscripten-core";
import { toVmValue } from "@/features/plugins/quickjs/bridge";

/** The console methods a Plugin may call. */
export type QuickJsConsoleLevel = "log" | "info" | "warn" | "error" | "debug";

/** A host `URL` flattened to the parts a Plugin reads. */
export interface QuickJsUrlParts {
  href: string;
  origin: string;
  protocol: string;
  username: string;
  password: string;
  host: string;
  hostname: string;
  port: string;
  pathname: string;
  search: string;
  hash: string;
}

/** The host end of the globals: what only the host can do. */
export interface QuickJsGlobalsHost {
  /** `self.postMessage(data)`: hand a dumped value to the runner's endpoint. */
  postMessage(value: unknown): void;
  /** `performance.now()`. */
  now(): number;
  /** `console.*`: forward one level and its arguments to the host console. */
  console(level: QuickJsConsoleLevel, args: unknown[]): void;
  /** `setTimeout`/`setInterval`: schedule a host timer for a duped VM callback. */
  setTimer(callback: QuickJSHandle, delayMs: number, repeat: boolean): number;
  /** `clearTimeout`/`clearInterval`: cancel a host timer. */
  clearTimer(timerId: number): void;
  /** Parse an absolute URL, or resolve one against a base; throws on an invalid one. */
  parseUrl(input: string, base: string | undefined): QuickJsUrlParts;
}

/**
 * Install the Android global set on a fresh context. Returns a handle to the
 * scope dispatcher: the runner calls it with `(data, ports)` to replay the
 * init event and every host scope message, exactly as `PRELUDE_SOURCE` does.
 */
export function installQuickJsGlobals(
  context: QuickJSContext,
  host: QuickJsGlobalsHost
): QuickJSHandle {
  const hostObject = context.newObject();
  const put = (name: string, handle: QuickJSHandle) => {
    context.setProp(hostObject, name, handle);
    handle.dispose();
  };

  put(
    "postMessage",
    context.newFunction("postMessage", (value) => {
      host.postMessage(context.dump(value));
    })
  );
  put(
    "now",
    context.newFunction("now", () => context.newNumber(host.now()))
  );
  put(
    "consoleLog",
    context.newFunction("consoleLog", (level, args) => {
      host.console(
        context.getString(level) as QuickJsConsoleLevel,
        context.dump(args) as unknown[]
      );
    })
  );
  put(
    "setTimer",
    context.newFunction("setTimer", (callback, delay, repeat) => {
      const delayMs = Math.trunc(context.getNumber(delay)) | 0;
      const id = host.setTimer(
        callback.dup(),
        delayMs > 0 ? delayMs : 0,
        context.getNumber(repeat) !== 0
      );
      return context.newNumber(id);
    })
  );
  put(
    "clearTimer",
    context.newFunction("clearTimer", (id) => {
      host.clearTimer(context.getNumber(id));
    })
  );
  put(
    "urlParse",
    context.newFunction("urlParse", (input, base) => {
      const parts = host.parseUrl(
        context.getString(input),
        base === undefined ? undefined : context.getString(base)
      );
      return toVmValue(context, parts);
    })
  );
  context.setProp(context.global, "__maibukGlobalsHost", hostObject);
  hostObject.dispose();

  const installed = context.evalCode(buildGlobalsSource());
  if (installed.error) {
    const dumped = context.dump(installed.error) as { message?: unknown } | string;
    installed.error.dispose();
    throw new Error(
      typeof dumped === "string"
        ? dumped
        : String(dumped?.message ?? "QuickJS globals install failed")
    );
  }
  installed.value.dispose();

  const scope = context.getProp(context.global, "__maibukQuickJsScope");
  const dispatch = context.getProp(scope, "dispatch");
  scope.dispose();
  return dispatch;
}

/**
 * The VM shim. It is plain ES5 + typed arrays so it evaluates on any v6 engine.
 * `dispatch(data, ports)` replays one scope `message` event: the `onmessage`
 * handler if the Plugin set one, otherwise each `message` listener, matching
 * the prelude's replay. Built at call time so `URL_SOURCE` and `TEXT_SOURCE`
 * are already initialized when it composes them.
 */
function buildGlobalsSource(): string {
  return `(function () {
  "use strict";
  var host = globalThis.__maibukGlobalsHost;

  globalThis.self = globalThis;

  try { delete globalThis.Intl; } catch (e) {}
  try { delete globalThis.WebAssembly; } catch (e) {}

  var scopeOnMessage = null;
  var scopeListeners = new Set();
  Object.defineProperty(globalThis, "onmessage", {
    configurable: true,
    enumerable: true,
    get: function () { return scopeOnMessage; },
    set: function (value) { scopeOnMessage = value; },
  });
  globalThis.addEventListener = function (type, listener) {
    if (type === "message" && typeof listener === "function") scopeListeners.add(listener);
  };
  globalThis.removeEventListener = function (type, listener) {
    if (type === "message") scopeListeners.delete(listener);
  };
  globalThis.postMessage = function (data) { host.postMessage(data); };

  function toDelay(value) {
    var n = Number(value);
    return n > 0 && n < 2147483647 ? n | 0 : 0;
  }
  function wrap(callback, extra) {
    if (typeof callback !== "function") return function () {};
    if (extra.length === 0) return callback;
    return function () { return callback.apply(undefined, extra); };
  }
  globalThis.setTimeout = function (callback, delay) {
    return host.setTimer(wrap(callback, Array.prototype.slice.call(arguments, 2)), toDelay(delay), false);
  };
  globalThis.setInterval = function (callback, delay) {
    return host.setTimer(wrap(callback, Array.prototype.slice.call(arguments, 2)), toDelay(delay), true);
  };
  globalThis.clearTimeout = function (id) { host.clearTimer(Number(id) | 0); };
  globalThis.clearInterval = function (id) { host.clearTimer(Number(id) | 0); };

  if (typeof globalThis.queueMicrotask !== "function") {
    globalThis.queueMicrotask = function (callback) {
      Promise.resolve().then(callback);
    };
  }

  Object.defineProperty(globalThis, "performance", {
    value: Object.freeze({ now: function () { return host.now(); } }),
    writable: true,
    configurable: true,
    enumerable: false,
  });

  function consoleMethod(level) {
    return function () { host.consoleLog(level, Array.prototype.slice.call(arguments)); };
  }
  globalThis.console = {
    log: consoleMethod("log"),
    info: consoleMethod("info"),
    warn: consoleMethod("warn"),
    error: consoleMethod("error"),
    debug: consoleMethod("debug"),
  };

${URL_SOURCE}
${TEXT_SOURCE}
${DOM_SOURCE}

  globalThis.__maibukQuickJsScope = {
    dispatch: function (data, ports) {
      var event = { type: "message", data: data, ports: ports || [] };
      var handler = scopeOnMessage;
      if (typeof handler === "function") {
        handler.call(globalThis, event);
        return;
      }
      var listeners = Array.from(scopeListeners);
      for (var i = 0; i < listeners.length; i++) listeners[i].call(globalThis, event);
    },
  };
})();`;
}

/** `URL` (host-parsed) and a VM `URLSearchParams`. */
const URL_SOURCE = `  function encodeForm(component) {
    return encodeURIComponent(String(component))
      .replace(/%20/g, "+")
      .replace(/[!'()~]/g, function (char) {
        return "%" + char.charCodeAt(0).toString(16).toUpperCase();
      });
  }
  function decodeForm(component) {
    return decodeURIComponent(String(component).replace(/\\+/g, " "));
  }
  function formatQuery(entries) {
    var parts = [];
    for (var i = 0; i < entries.length; i++) {
      parts.push(encodeForm(entries[i][0]) + "=" + encodeForm(entries[i][1]));
    }
    return parts.join("&");
  }
  function URLSearchParams(init) {
    this.__entries = [];
    if (init === undefined || init === null) return;
    if (typeof init === "string") {
      var query = init.charAt(0) === "?" ? init.slice(1) : init;
      if (query === "") return;
      var parts = query.split("&");
      for (var i = 0; i < parts.length; i++) {
        if (parts[i] === "") continue;
        var equal = parts[i].indexOf("=");
        var name = equal === -1 ? parts[i] : parts[i].slice(0, equal);
        var value = equal === -1 ? "" : parts[i].slice(equal + 1);
        this.__entries.push([decodeForm(name), decodeForm(value)]);
      }
      return;
    }
    if (Array.isArray(init)) {
      for (var j = 0; j < init.length; j++) this.append(init[j][0], init[j][1]);
      return;
    }
    var keys = Object.keys(init);
    for (var k = 0; k < keys.length; k++) this.append(keys[k], init[keys[k]]);
  }
  URLSearchParams.prototype.append = function (name, value) {
    this.__entries.push([String(name), String(value)]);
  };
  URLSearchParams.prototype.delete = function (name, value) {
    var target = String(name);
    var keep = [];
    var removeAll = value === undefined;
    var targetValue = removeAll ? null : String(value);
    for (var i = 0; i < this.__entries.length; i++) {
      var entry = this.__entries[i];
      if (entry[0] === target && (removeAll || entry[1] === targetValue)) continue;
      keep.push(entry);
    }
    this.__entries = keep;
  };
  URLSearchParams.prototype.get = function (name) {
    var target = String(name);
    for (var i = 0; i < this.__entries.length; i++) {
      if (this.__entries[i][0] === target) return this.__entries[i][1];
    }
    return null;
  };
  URLSearchParams.prototype.getAll = function (name) {
    var target = String(name);
    var out = [];
    for (var i = 0; i < this.__entries.length; i++) {
      if (this.__entries[i][0] === target) out.push(this.__entries[i][1]);
    }
    return out;
  };
  URLSearchParams.prototype.has = function (name, value) {
    var target = String(name);
    var targetValue = value === undefined ? null : String(value);
    for (var i = 0; i < this.__entries.length; i++) {
      if (this.__entries[i][0] === target && (targetValue === null || this.__entries[i][1] === targetValue)) {
        return true;
      }
    }
    return false;
  };
  URLSearchParams.prototype.set = function (name, value) {
    var target = String(name);
    var found = false;
    var keep = [];
    for (var i = 0; i < this.__entries.length; i++) {
      if (this.__entries[i][0] !== target) { keep.push(this.__entries[i]); continue; }
      if (!found) { keep.push([target, String(value)]); found = true; }
    }
    if (!found) keep.push([target, String(value)]);
    this.__entries = keep;
  };
  URLSearchParams.prototype.sort = function () {
    this.__entries.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
  };
  URLSearchParams.prototype.toString = function () { return formatQuery(this.__entries); };
  URLSearchParams.prototype.forEach = function (callback, thisArg) {
    for (var i = 0; i < this.__entries.length; i++) {
      callback.call(thisArg, this.__entries[i][1], this.__entries[i][0], this);
    }
  };
  URLSearchParams.prototype.entries = function () { return this.__entries.slice()[Symbol.iterator](); };
  URLSearchParams.prototype.keys = function () {
    return this.__entries.map(function (entry) { return entry[0]; })[Symbol.iterator]();
  };
  URLSearchParams.prototype.values = function () {
    return this.__entries.map(function (entry) { return entry[1]; })[Symbol.iterator]();
  };
  URLSearchParams.prototype[Symbol.iterator] = URLSearchParams.prototype.entries;

  function defineRead(proto, name, read) {
    Object.defineProperty(proto, name, { configurable: true, enumerable: true, get: read });
  }

  function URL(input, base) {
    if (!(this instanceof URL)) {
      throw new TypeError("Failed to construct 'URL': Please use the 'new' operator");
    }
    this.__parts = host.urlParse(String(input), base === undefined ? undefined : String(base));
    this.__searchParams = null;
  }
  defineRead(URL.prototype, "href", function () { return this.__parts.href; });
  defineRead(URL.prototype, "origin", function () { return this.__parts.origin; });
  defineRead(URL.prototype, "protocol", function () { return this.__parts.protocol; });
  defineRead(URL.prototype, "username", function () { return this.__parts.username; });
  defineRead(URL.prototype, "password", function () { return this.__parts.password; });
  defineRead(URL.prototype, "host", function () { return this.__parts.host; });
  defineRead(URL.prototype, "hostname", function () { return this.__parts.hostname; });
  defineRead(URL.prototype, "port", function () { return this.__parts.port; });
  defineRead(URL.prototype, "pathname", function () { return this.__parts.pathname; });
  defineRead(URL.prototype, "search", function () { return this.__parts.search; });
  defineRead(URL.prototype, "hash", function () { return this.__parts.hash; });
  defineRead(URL.prototype, "searchParams", function () {
    if (this.__searchParams === null) this.__searchParams = new URLSearchParams(this.__parts.search);
    return this.__searchParams;
  });
  URL.prototype.toString = function () { return this.__parts.href; };
  URL.prototype.toJSON = function () { return this.__parts.href; };

  globalThis.URL = URL;
  globalThis.URLSearchParams = URLSearchParams;
`;

/** `TextEncoder`/`TextDecoder`, UTF-8 only. */
const TEXT_SOURCE = `  function TextEncoder() { this.encoding = "utf-8"; }
  TextEncoder.prototype.encode = function (input) {
    var text = input === undefined ? "" : String(input);
    var bytes = [];
    for (var i = 0; i < text.length; i++) {
      var code = text.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
        var next = text.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
          i++;
        }
      }
      if (code < 0x80) {
        bytes.push(code);
      } else if (code < 0x800) {
        bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
      } else if (code < 0x10000) {
        bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      } else {
        bytes.push(
          0xf0 | (code >> 18),
          0x80 | ((code >> 12) & 0x3f),
          0x80 | ((code >> 6) & 0x3f),
          0x80 | (code & 0x3f)
        );
      }
    }
    return new Uint8Array(bytes);
  };

  function TextDecoder(label, options) {
    this.encoding = "utf-8";
    this.fatal = !!(options && options.fatal);
    this.ignoreBOM = !!(options && options.ignoreBOM);
  }
  TextDecoder.prototype.decode = function (input) {
    var bytes;
    if (input === undefined) bytes = new Uint8Array(0);
    else if (input instanceof Uint8Array) bytes = input;
    else if (input instanceof ArrayBuffer) bytes = new Uint8Array(input);
    else if (ArrayBuffer.isView(input)) {
      bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    } else bytes = new Uint8Array(input);
    var out = "";
    var i = 0;
    while (i < bytes.length) {
      var byte = bytes[i];
      var code;
      var extra;
      if (byte < 0x80) { code = byte; extra = 0; }
      else if ((byte & 0xe0) === 0xc0) { code = byte & 0x1f; extra = 1; }
      else if ((byte & 0xf0) === 0xe0) { code = byte & 0x0f; extra = 2; }
      else if ((byte & 0xf8) === 0xf0) { code = byte & 0x07; extra = 3; }
      else { out += "\\ufffd"; i++; continue; }
      if (i + extra >= bytes.length) { out += "\\ufffd"; i++; continue; }
      var ok = true;
      for (var j = 1; j <= extra; j++) {
        var cont = bytes[i + j];
        if ((cont & 0xc0) !== 0x80) { ok = false; break; }
        code = (code << 6) | (cont & 0x3f);
      }
      if (!ok) { out += "\\ufffd"; i++; continue; }
      i += extra + 1;
      if (code > 0xffff) {
        code -= 0x10000;
        out += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff));
      } else {
        out += String.fromCharCode(code);
      }
    }
    return out;
  };

  globalThis.TextEncoder = TextEncoder;
  globalThis.TextDecoder = TextDecoder;
`;

/**
 * The DOM-like classes Remote DOM and `@quilted/threads` touch at module scope,
 * and the `crypto` they reach for at call time. A Worker provides these
 * natively; QuickJS does not. They are pure-JS shims evaluated inside the VM
 * with no host callbacks, so the plan's host global set stays exactly its list.
 *
 * Remote DOM's element base classes extend these at module scope
 * (`RemoteElement extends HTMLElement`, `RemoteEvent extends CustomEvent`,
 * `RemoteMutationObserver extends MutationObserver`), which a Plugin built from
 * the real build always pulls in once the SDK is imported, even when the Plugin
 * declares no UI. The UI path additionally loads `@/plugin-sdk/worker-ui`, whose
 * Remote DOM polyfill replaces the DOM shims with its own implementation before
 * any element is created; `AbortController`/`AbortSignal` (used by
 * `@quilted/threads`) and `crypto.getRandomValues` (used by its call ids) are
 * not part of that polyfill and stay as these shims.
 */
const DOM_SOURCE = `  function EventTarget() { this.__listeners = new Map(); }
  EventTarget.prototype.addEventListener = function (type, listener) {
    if (typeof listener !== "function" && !(listener && typeof listener.handleEvent === "function")) return;
    var set = this.__listeners.get(type);
    if (set === undefined) { set = new Set(); this.__listeners.set(type, set); }
    set.add(listener);
  };
  EventTarget.prototype.removeEventListener = function (type, listener) {
    var set = this.__listeners.get(type);
    if (set !== undefined) set.delete(listener);
  };
  EventTarget.prototype.dispatchEvent = function (event) {
    var set = event === null || event === undefined ? undefined : this.__listeners.get(event.type);
    if (event !== null && event !== undefined) {
      event.target = this;
      event.currentTarget = this;
    }
    if (set === undefined) return true;
    var listeners = Array.from(set);
    for (var i = 0; i < listeners.length; i++) {
      var listener = listeners[i];
      if (typeof listener === "function") listener.call(this, event);
      else listener.handleEvent(event);
    }
    return true;
  };

  function Event(type, init) {
    var options = init || {};
    this.type = String(type);
    this.bubbles = !!options.bubbles;
    this.cancelable = !!options.cancelable;
    this.composed = !!options.composed;
    this.defaultPrevented = false;
    this.target = null;
    this.currentTarget = null;
    this.timeStamp = 0;
  }
  Event.prototype.preventDefault = function () { this.defaultPrevented = true; };
  Event.prototype.stopPropagation = function () {};
  Event.prototype.stopImmediatePropagation = function () {};

  function CustomEvent(type, init) {
    var options = init || {};
    Event.call(this, type, options);
    this.detail = options.detail === undefined ? null : options.detail;
  }
  CustomEvent.prototype = Object.create(Event.prototype);
  CustomEvent.prototype.constructor = CustomEvent;

  function HTMLElement() {}
  HTMLElement.prototype = Object.create(EventTarget.prototype);
  HTMLElement.prototype.constructor = HTMLElement;

  function MutationObserver(callback) { this.__callback = callback; }
  MutationObserver.prototype.observe = function () {};
  MutationObserver.prototype.disconnect = function () {};
  MutationObserver.prototype.takeRecords = function () { return []; };

  function AbortSignal() {
    EventTarget.call(this);
    this.aborted = false;
    this.reason = undefined;
    this.onabort = null;
  }
  AbortSignal.prototype = Object.create(EventTarget.prototype);
  AbortSignal.prototype.constructor = AbortSignal;
  AbortSignal.prototype.throwIfAborted = function () {
    if (!this.aborted) return;
    throw this.reason === undefined ? new Error("AbortError") : this.reason;
  };

  function AbortController() { this.signal = new AbortSignal(); }
  AbortController.prototype.abort = function (reason) {
    var signal = this.signal;
    if (signal.aborted) return;
    signal.aborted = true;
    signal.reason = reason === undefined ? new Error("AbortError") : reason;
    var event = new Event("abort");
    event.target = signal;
    if (typeof signal.onabort === "function") signal.onabort.call(signal, event);
    signal.dispatchEvent(event);
  };

  if (typeof globalThis.crypto === "undefined") {
    globalThis.crypto = {
      getRandomValues: function (array) {
        for (var index = 0; index < array.length; index++) {
          array[index] = Math.floor(Math.random() * 256);
        }
        return array;
      },
    };
  }

  globalThis.EventTarget = EventTarget;
  globalThis.Event = Event;
  globalThis.CustomEvent = CustomEvent;
  globalThis.HTMLElement = HTMLElement;
  globalThis.MutationObserver = MutationObserver;
  globalThis.AbortSignal = AbortSignal;
  globalThis.AbortController = AbortController;
`;
