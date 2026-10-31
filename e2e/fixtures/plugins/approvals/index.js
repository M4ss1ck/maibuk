// The approvals fixture Plugin (issue #442): a minimal Plugin over the raw wire
// protocol, so the folder the E2E lane seeds into OPFS needs no build step. It
// is never shipped. In a Worker it receives the init message with its
// MessagePort, answers the host's health check, makes one broker call
// (`notifications.show`) so the spec can see it ran, and runs one Command that
// reads the focused editor through its optional `editor:read` grant, reporting
// whether the call was allowed or refused. A refused optional grant leaves the
// Plugin running, so the report is the observable proof of a revoked grant.
//
// Since #445 the Worker also reports its activation's `startReason` in the run
// report (read from the init message the host posts on the port, before the
// health check), and subscribes to `library.availabilityChanged`, reporting
// each change. A spec can then watch a running Plugin cross the Tutorial
// boundary (it stays alive) and a Restore (it restarts with `startReason`
// `restore`).
//
// `setup` is exported so the Vitest test kit can drive the same bytes in
// process.

// The Settings row's live body, over the raw wire (#450). The host mounts the
// declared row the way it mounts a page, and the Plugin answers the mount and
// sends the Remote DOM records that draw a switch. This fixture has no build
// step, so the protocol constants and the one record batch are written by hand:
// the records travel as a `@quilted/threads` call of the host's exported
// `mutate` (an array `[MESSAGE_CALL, id, "mutate", [records]]`), and the
// element's required `label` is set by an update-property record, checked at
// the end of the batch. Records follow Remote DOM's tuple layout.
const MESSAGE_CALL = 1;
const MUTATION_TYPE_INSERT_CHILD = 0;
const MUTATION_TYPE_UPDATE_PROPERTY = 3;
const NODE_TYPE_ELEMENT = 1;
/** Remote DOM's fixed root id. */
const ROOT_ID = "~";

function drawKeptRow(mountPort) {
  mountPort.start();
  const records = [
    [
      MUTATION_TYPE_INSERT_CHILD,
      ROOT_ID,
      {
        id: "kept-1",
        type: NODE_TYPE_ELEMENT,
        element: "maibuk-switch",
        properties: {},
        children: [],
      },
      0,
    ],
    [MUTATION_TYPE_UPDATE_PROPERTY, "kept-1", "label", "Approvals kept data"],
    [MUTATION_TYPE_UPDATE_PROPERTY, "kept-1", "isSelected", false],
  ];
  mountPort.postMessage([MESSAGE_CALL, "kept-row", "mutate", [records]]);
}

export function setup(port) {
  let nextId = 1;
  let reported = false;
  let startReason = "unknown";
  const pending = new Map();
  // Reports are serialized and retried past the host's 1-per-5 s notification
  // limit, so a spec sees every one it waits for even when two land close (a
  // start report followed by an availability change).
  let queue = Promise.resolve();

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function call(method, params) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      port.postMessage(JSON.stringify({ kind: "call", id, method, params: params ?? {} }));
    });
  }

  async function show(message) {
    // The host admits at most one notification every 5 s, so a refused report
    // retries until the slot frees rather than drop, and the queue below keeps
    // their order.
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        await call("notifications.show", { variant: "info", message });
        return;
      } catch (error) {
        if (error && error.code === "rate-limited") {
          await sleep(1000);
          continue;
        }
        return;
      }
    }
  }

  function report(message) {
    queue = queue.then(() => show(message)).catch(() => {});
    return queue;
  }

  function subscribe(event) {
    port.postMessage(JSON.stringify({ kind: "subscribe", id: nextId++, event }));
  }

  async function run(commandId) {
    if (commandId !== "readEditor") return;
    try {
      await call("editor.getSelection");
      report("approvals editor ok");
    } catch (error) {
      const code = (error && error.code) || "error";
      report(`approvals editor refused: ${code}`);
    }
  }

  // The Library's availability crosses the Tutorial boundary while this Worker
  // stays alive (#445). The event still reaches a subscribed Plugin (only its
  // rows refuse), so a spec can see it lived through the boundary.
  subscribe("library.availabilityChanged");

  port.onmessage = (event) => {
    const message = event.data;
    if (typeof message !== "object" || message === null) return;
    // The host announces why it activated this Worker on the init message,
    // before the health check (#400, #445).
    if (message.kind === "maibuk:plugin-init") {
      if (typeof message.startReason === "string") startReason = message.startReason;
      return;
    }
    if (message.kind === "event") {
      if (message.event === "library.availabilityChanged") {
        const payload = message.payload || {};
        // The event's reason is reported when the host sends one, so a spec
        // can assert the Tutorial boundary's reason on both sides (#445).
        const reason = typeof payload.reason === "string" ? ` (${payload.reason})` : "";
        report(`library available: ${payload.available === true}${reason}`);
      }
      return;
    }
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
      // One report per Worker: the heartbeat asks again every second, and a
      // restart is a fresh Worker, which reports its own start.
      if (!reported) {
        reported = true;
        report(`approvals fixture running (started: ${startReason})`);
      }
      return;
    }
    if (message.method === "command.run") {
      const params = message.params || {};
      port.postMessage(JSON.stringify({ kind: "reply", id: message.id, ok: true, result: null }));
      void run(params.id);
      return;
    }
    if (message.method === "ui.mount") {
      // The host mounts the declared Settings row (#450): accept it, then draw
      // the row's own control over the transferred port.
      const params = message.params || {};
      port.postMessage(JSON.stringify({ kind: "reply", id: message.id, ok: true, result: null }));
      if (params.port) drawKeptRow(params.port);
      return;
    }
    if (message.method === "ui.unmount") {
      port.postMessage(JSON.stringify({ kind: "reply", id: message.id, ok: true, result: null }));
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
