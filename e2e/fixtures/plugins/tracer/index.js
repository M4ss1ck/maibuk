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

  port.onmessage = (event) => {
    const message = event.data;
    if (typeof message !== "object" || message === null) return;
    if (message.kind === "request") {
      if (message.method === "health.check") {
        port.postMessage(
          JSON.stringify({ kind: "reply", id: message.id, ok: true, result: "pong" })
        );
        void report(port, fetchImpl, nextId++);
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
  } catch {
    outcome = "refused";
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
