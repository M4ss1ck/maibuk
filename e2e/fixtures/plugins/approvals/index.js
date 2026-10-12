// The approvals fixture Plugin (issue #442): a minimal Plugin over the raw wire
// protocol, so the folder the E2E lane seeds into OPFS needs no build step. It
// is never shipped. In a Worker it receives the init message with its
// MessagePort, answers the host's health check, makes one broker call
// (`notifications.show`) so the spec can see it ran, and runs one Command that
// reads the focused editor through its optional `editor:read` grant, reporting
// whether the call was allowed or refused. A refused optional grant leaves the
// Plugin running, so the report is the observable proof of a revoked grant.
//
// `setup` is exported so the Vitest test kit can drive the same bytes in
// process.

export function setup(port) {
  let nextId = 1;
  let reported = false;
  const pending = new Map();

  function call(method, params) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      port.postMessage(JSON.stringify({ kind: "call", id, method, params: params ?? {} }));
    });
  }

  function notify(message) {
    // Fire and forget; the host admits at most one notification every 5 s, so a
    // second report inside that window is refused and simply drops.
    port.postMessage(
      JSON.stringify({
        kind: "call",
        id: nextId++,
        method: "notifications.show",
        params: { variant: "info", message },
      })
    );
  }

  async function run(commandId) {
    if (commandId !== "readEditor") return;
    try {
      await call("editor.getSelection");
      notify("approvals editor ok");
    } catch (error) {
      const code = (error && error.code) || "error";
      notify(`approvals editor refused: ${code}`);
    }
  }

  port.onmessage = (event) => {
    const message = event.data;
    if (typeof message !== "object" || message === null) return;
    if (message.kind === "result") {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.ok) entry.resolve(message.result);
      else entry.reject(message.error ?? { code: "internal-error", message: "failed" });
      return;
    }
    if (message.kind !== "request") return;
    if (message.method === "health.check") {
      port.postMessage(JSON.stringify({ kind: "reply", id: message.id, ok: true, result: "pong" }));
      // One report per Worker: the heartbeat asks again every second, and the
      // host caps notifications at one per 5 s, so a repeat would hold that
      // slot forever and starve the Command's own report.
      if (!reported) {
        reported = true;
        notify("approvals fixture running");
      }
      return;
    }
    if (message.method === "command.run") {
      const params = message.params || {};
      port.postMessage(JSON.stringify({ kind: "reply", id: message.id, ok: true, result: null }));
      void run(params.id);
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
  };
}

if (
  typeof self !== "undefined" &&
  typeof WorkerGlobalScope !== "undefined" &&
  self instanceof WorkerGlobalScope
) {
  self.onmessage = (event) => {
    const port = event.ports && event.ports[0];
    if (!port) return;
    setup(port);
    self.postMessage({ kind: "maibuk:plugin-ready" });
  };
}
