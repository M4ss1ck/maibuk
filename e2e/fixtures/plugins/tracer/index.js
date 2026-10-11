// The tracer fixture Plugin (issue #434): a minimal Plugin over the raw wire
// protocol, so the folder the E2E lane seeds into OPFS needs no build step.
// It is never shipped. In a Worker it receives the init message with its
// MessagePort, signals ready, answers the host's health check, then makes one
// broker call. Before that call it tries a direct fetch, which the sandbox CSP
// must refuse; the outcome travels in the notification so the spec can see it.
//
// `setup` is exported so the Vitest test kit can drive the same bytes in
// process; there `fetch` is injected instead of taken from the global scope.

import { buildNotification } from "./report.js";

const LEAK_URL = "https://tracer.invalid/leak";

export function setup(port, options = {}) {
  const fetchImpl = options.fetch ?? fetch;
  let nextId = 1;
  // The heartbeat asks the health check every second; the fetch report is a
  // one-time proof, and a second notification would hit the 1-per-5s limit.
  let reported = false;

  port.onmessage = (event) => {
    const message = event.data;
    if (typeof message !== "object" || message === null) return;
    if (message.kind === "request") {
      if (message.method === "health.check") {
        port.postMessage(
          JSON.stringify({ kind: "reply", id: message.id, ok: true, result: "pong" })
        );
        if (!reported) {
          reported = true;
          void report(port, fetchImpl, nextId++);
        }
        return;
      }
      if (message.method === "command.run") {
        // The host ran one of this Plugin's Commands. Answer, then surface the
        // round trip as a toast so the spec can see the target travel intact.
        const params = message.params || {};
        const target = params.target ? ` on ${params.target.kind}` : "";
        port.postMessage(
          JSON.stringify({ kind: "reply", id: message.id, ok: true, result: null })
        );
        port.postMessage(
          JSON.stringify({
            kind: "call",
            id: nextId++,
            method: "notifications.show",
            params: { variant: "info", message: `tracer ran ${params.id}${target}` },
          })
        );
        return;
      }
      port.postMessage(
        JSON.stringify({
          kind: "reply",
          id: message.id,
          ok: false,
          error: { code: "unknown-method", message: message.method },
        })
      );
    }
  };
}

async function report(port, fetchImpl, id) {
  let outcome = "allowed";
  try {
    await fetchImpl(LEAK_URL);
  } catch (error) {
    // Report the real error, not a bare "refused": a throw for any reason
    // (DNS, abort, the CSP) must stay distinguishable in the toast.
    const name = (error && error.name) || "Error";
    const message = (error && error.message) || String(error);
    outcome = `refused (${name}: ${message})`;
  }
  port.postMessage(
    JSON.stringify({
      kind: "call",
      id,
      method: "notifications.show",
      params: buildNotification(outcome),
    })
  );
}

if (typeof self !== "undefined" && typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope) {
  self.onmessage = (event) => {
    const port = event.ports && event.ports[0];
    if (!port) return;
    setup(port);
    self.postMessage({ kind: "maibuk:plugin-ready" });
  };
}
