/**
 * The sandbox gate (ADR 0019): the frame's bootstrap is fixed host code that
 * never evaluates Plugin bytes and never loads Plugin HTML. It may only create
 * `blob:` module URLs from sources the host sent, start one module Worker from
 * one of them, and forward messages and the single MessagePort. This suite
 * fails when the bootstrap grows an evaluation or HTML sink, when the frame
 * loses its sandbox attributes or CSP, or when the frame's document stops
 * being exactly the bootstrap.
 */

import { describe, expect, it } from "vitest";
import { BOOTSTRAP_HTML, PRELUDE_SOURCE, createPluginFrame } from "@/features/plugins/sandbox";
import { PLUGIN_BOOT_MESSAGE, PLUGIN_INIT_MESSAGE } from "@/plugin-sdk/protocol";

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
      "indexedDB",
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

  it("speaks the protocol's boot and init kinds and forwards Worker messages", () => {
    expect(script).toContain(PLUGIN_BOOT_MESSAGE.kind);
    expect(script).toContain(PLUGIN_INIT_MESSAGE.kind);
    expect(script).toContain('kind: "worker-message"');
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

  it("only imports the host-named entry and hands over the init message", () => {
    expect(PRELUDE_SOURCE.match(/import\(/g)).toHaveLength(1);
    expect(PRELUDE_SOURCE).toContain("await import(entry)");
    expect(PRELUDE_SOURCE).toContain(PLUGIN_BOOT_MESSAGE.kind);
    expect(PRELUDE_SOURCE).toContain(PLUGIN_INIT_MESSAGE.kind);
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
