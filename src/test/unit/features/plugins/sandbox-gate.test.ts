/**
 * The sandbox gate (ADR 0019): the frame's bootstrap is fixed host code that
 * never evaluates Plugin bytes and never loads Plugin HTML. It may only create
 * `blob:` module URLs from sources the host sent, start one module Worker from
 * one of them, and forward messages and the single MessagePort. The Worker's
 * fixed prelude imports only the boot-named entry (native) or the boot-named
 * QuickJS runner (#516); on the QuickJS branch the Plugin's sources cross as
 * data and are never imported, evaluated, or turned into a `blob:`. This suite
 * fails when the bootstrap grows an evaluation or HTML sink, when the frame
 * loses its sandbox attributes or CSP, or when the frame's document stops being
 * exactly the bootstrap.
 */

import { describe, expect, it } from "vitest";
import { BOOTSTRAP_HTML, PRELUDE_SOURCE, createPluginFrame } from "@/features/plugins/sandbox";
import { QUICKJS_MEMORY_DEATH_MESSAGE } from "@/features/plugins/quickjs/constants";
import {
  PLUGIN_BOOT_MESSAGE,
  PLUGIN_ERROR_MESSAGE,
  PLUGIN_INIT_MESSAGE,
  PLUGIN_READY_MESSAGE,
} from "@/plugin-sdk/protocol";

function bootstrapScript(): string {
  const match = /<script>([\s\S]*)<\/script>/.exec(BOOTSTRAP_HTML);
  if (!match) throw new Error("the bootstrap has no script");
  return match[1];
}

describe("the sandbox bootstrap source", () => {
  const script = bootstrapScript();

  it("has no evaluation sink for Plugin bytes", () => {
    for (const banned of ["eval(", "new Function", "Function(", "setTimeout(", "setInterval("]) {
      expect(script, `bootstrap contains ${banned}`).not.toContain(banned);
    }
  });

  it("has no HTML sink for Plugin bytes", () => {
    for (const banned of [
      "innerHTML",
      "outerHTML",
      "insertAdjacentHTML",
      "document.write",
      "createContextualFragment",
      "DOMParser",
      "srcdoc",
    ]) {
      expect(script, `bootstrap contains ${banned}`).not.toContain(banned);
    }
  });

  it("has no network or storage path of its own", () => {
    for (const banned of [
      "fetch(",
      "XMLHttpRequest",
      "WebSocket",
      "EventSource",
      "importScripts",
      "localStorage",
      "sessionStorage",
      "indexedDB",
      "caches",
    ]) {
      expect(script, `bootstrap contains ${banned}`).not.toContain(banned);
    }
  });

  it("only creates blob URLs and one Worker, and imports the entry the host named", () => {
    expect(script).toContain("URL.createObjectURL");
    expect(script).toContain("new Blob(");
    expect(script.match(/new Worker\(/g)).toHaveLength(1);
    expect(script).toContain("await import(entry)");
  });

  it("starts a classic Worker from a host-created prelude blob", () => {
    // Chromium refuses a module Worker from a blob: URL in an opaque-origin
    // document; the classic Worker with a fixed prelude is the cross-engine
    // shape (see sandbox.ts).
    expect(script).toContain("new Worker(prelude)");
    expect(script).not.toContain('type: "module"');
  });

  it("speaks the protocol's sandbox kinds and forwards only the first ready or error", () => {
    expect(script).toContain(PLUGIN_BOOT_MESSAGE.kind);
    expect(script).toContain(PLUGIN_INIT_MESSAGE.kind);
    expect(script).toContain(PLUGIN_READY_MESSAGE.kind);
    expect(script).toContain(PLUGIN_ERROR_MESSAGE.kind);
    // Exactly one worker-message send, and its one-shot guard runs first:
    // a Plugin's own self.postMessage chatter never reaches the host window.
    expect(script).toContain('kind: "worker-message"');
    expect(script.match(/kind: "worker-message"/g)).toHaveLength(1);
    const readyGuard = script.indexOf("if (readyForwarded) return;");
    const readySend = script.indexOf('kind: "worker-message"');
    expect(readyGuard).toBeGreaterThan(-1);
    expect(readyGuard).toBeLessThan(readySend);
    expect(script).toContain("readyForwarded = true;");
    expect(script).toContain("if (errorForwarded) return;");
    expect(script).toContain("errorForwarded = true;");
  });

  it("relays the QuickJS boot fields without evaluating Plugin bytes", () => {
    // The Android fields are only relayed when the host set them; the Wasm
    // Module crosses as a structured clone, and the bootstrap still evaluates
    // nothing — its one Worker and one createObjectURL path are unchanged.
    expect(script).toContain('message.engine === "quickjs"');
    expect(script).toContain("boot.runner = message.runner");
    expect(script).toContain("boot.sources = message.sources");
    expect(script).toContain("boot.wasmModule = message.wasmModule");
    expect(script.match(/new Worker\(/g)).toHaveLength(1);
    expect(script).toContain("URL.createObjectURL");
  });
});

describe("the sandbox Worker prelude source", () => {
  it("has no evaluation or HTML sink for Plugin bytes", () => {
    for (const banned of [
      "eval(",
      "new Function",
      "Function(",
      "setTimeout(",
      "setInterval(",
      "innerHTML",
      "outerHTML",
      "insertAdjacentHTML",
      "document.",
      "DOMParser",
      "srcdoc",
      "fetch(",
      "XMLHttpRequest",
      "WebSocket",
      "EventSource",
      "importScripts",
      "localStorage",
      "sessionStorage",
      "indexedDB",
      "caches",
      "new Worker",
    ]) {
      expect(PRELUDE_SOURCE, `prelude contains ${banned}`).not.toContain(banned);
    }
  });

  it("imports only the boot-named entry and runner, and never a Plugin source", () => {
    // Exactly two dynamic imports: the native entry and the QuickJS runner. On
    // the QuickJS branch the Plugin's sources are data, never an import target.
    expect(PRELUDE_SOURCE.match(/import\(/g)).toHaveLength(2);
    expect(PRELUDE_SOURCE).toContain("await import(entry)");
    expect(PRELUDE_SOURCE).toContain("await import(runner)");
    expect(PRELUDE_SOURCE).toContain(PLUGIN_BOOT_MESSAGE.kind);
    expect(PRELUDE_SOURCE).toContain(PLUGIN_INIT_MESSAGE.kind);
  });

  it("runs Plugin sources as data on the QuickJS branch, never by eval, import, or blob", () => {
    // The branch is keyed off the boot message, never the runtime platform.
    expect(PRELUDE_SOURCE).toContain('message.engine === "quickjs"');
    // The verified sources only ever reach the runner as a property.
    expect(PRELUDE_SOURCE).toContain("sources: quickjs.sources");
    expect(PRELUDE_SOURCE).toContain("runQuickJsPlugin");
    // No evaluation sink, blob sink, or fetch for Plugin bytes anywhere.
    for (const banned of [
      "eval(",
      "new Function",
      "Function(",
      "URL.createObjectURL",
      "Blob(",
      "fetch(",
    ]) {
      expect(PRELUDE_SOURCE, `prelude contains ${banned}`).not.toContain(banned);
    }
  });

  it("reports a memory death from a fresh task so the Worker error path fires", () => {
    // Not a promise rejection: a fresh task's throw reaches worker.onerror,
    // which the lifecycle maps to the out-of-memory stop by this message.
    expect(PRELUDE_SOURCE).toContain("queueMicrotask(");
    expect(PRELUDE_SOURCE).toContain(QUICKJS_MEMORY_DEATH_MESSAGE);
  });
});

describe("the sandbox frame", () => {
  it("is a hidden host-owned frame that can only run scripts", () => {
    const frame = createPluginFrame(document);
    try {
      expect(frame.element.getAttribute("sandbox")).toBe("allow-scripts");
      expect(frame.element.getAttribute("sandbox")).not.toContain("allow-same-origin");
      expect(frame.element.getAttribute("aria-hidden")).toBe("true");
      expect(frame.element.tabIndex).toBe(-1);
      expect(frame.element.isConnected).toBe(true);
    } finally {
      frame.stop();
    }
    expect(frame.element.isConnected).toBe(false);
  });

  it("carries the CSP that refuses every network path", () => {
    const frame = createPluginFrame(document);
    try {
      const srcdoc = frame.element.getAttribute("srcdoc") ?? "";
      expect(srcdoc).toBe(BOOTSTRAP_HTML);
      expect(srcdoc).toContain("connect-src 'none'");
      expect(srcdoc).toContain("worker-src blob:");
      expect(srcdoc).toContain("script-src 'unsafe-inline' blob:");
      expect(srcdoc).toContain("default-src 'none'");
    } finally {
      frame.stop();
    }
  });
});
