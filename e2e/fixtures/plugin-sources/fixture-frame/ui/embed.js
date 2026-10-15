/* The embedded kit Frame's own script (issue #454 unit U6): it proves the
   Frame's port works for an embedded surface by round-tripping a ping. A classic
   script, like page.js, because a relative `import` cannot resolve in the
   opaque origin. */
(() => {
  const pong = document.querySelector('[data-testid="pong"]');
  const port = window.maibuk && window.maibuk.port;
  if (!port) return;
  port.onmessage = (event) => {
    const data = event.data;
    if (data && typeof data === "object" && data.kind === "pong" && pong) {
      pong.textContent = "pong";
    }
  };
  port.start();
  port.postMessage({ kind: "ping" });
})();
