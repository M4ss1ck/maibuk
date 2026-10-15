/* The fixture Frame's own script (issue #454 unit U6). It is a classic script
   loaded from the Plugin's verified hashed set: the host shim rewrites
   <script src="page.js"> to an in-Frame blob: URL and re-creates the element so
   it runs. A relative `import` would not resolve in the opaque origin, so this
   stays a plain script.

   It renders the Frame's deterministic data-testid nodes and runs the isolation
   probes. The recorder origin is substituted at build time
   (`e2e/support/plugin-fixtures-build.ts`), the same value the Worker bundle
   gets through Vite's `define`; the placeholder below is replaced there.

   Every probe starts "pending" in the HTML and writes "blocked" only on a
   *confirmed* refusal (a rejected fetch, an XHR/WebSocket/EventSource error or
   a close before open, a sendBeacon that returns false or whose CSP
   connect-src block fires a violation, an image error, absent Tauri globals, a
   parent/top document access that throws). A confirmed reach is
   "LEAK:<detail>". A probe that never ran stays "pending", so the spec fails:
   silence is not a pass. */
(() => {
  const REMOTE = "__REQUEST_LOG_ORIGIN__/frame";
  const SOCKET = REMOTE.replace(/^http/, "ws");
  const GREETINGS = {
    en: "Hello from the Frame",
    es: "Hola desde el Frame",
  };

  function write(id, text) {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (el) el.textContent = text;
  }

  // A connect-src block fires this. It is the only in-Frame evidence for a
  // sendBeacon the engine queued (see the beacon probe): Chromium returns true
  // from a CSP-blocked sendBeacon, so the return value alone is not a refusal.
  const violations = {};
  document.addEventListener("securitypolicyviolation", (event) => {
    violations[event.effectiveDirective] = true;
  });

  function readTokens() {
    const style = getComputedStyle(document.documentElement);
    write("token-bg", style.getPropertyValue("--maibuk-color-background").trim());
    write("scheme", style.getPropertyValue("--maibuk-color-scheme").trim());
  }

  function showLanguage(language) {
    const greeting = GREETINGS[language] || GREETINGS.en;
    write("lang", `${language}|${greeting}`);
  }

  function runProbes() {
    try {
      fetch(REMOTE, { mode: "no-cors" }).then(
        () => {
          write("probe-fetch", "LEAK:fetch-resolved");
        },
        () => {
          write("probe-fetch", "blocked");
        }
      );
    } catch {
      write("probe-fetch", "blocked");
    }

    try {
      const xhr = new XMLHttpRequest();
      xhr.onload = () => {
        write("probe-xhr", "LEAK:xhr-loaded");
      };
      xhr.onerror = () => {
        write("probe-xhr", "blocked");
      };
      xhr.onabort = () => {
        write("probe-xhr", "blocked");
      };
      xhr.open("GET", REMOTE);
      xhr.send();
    } catch {
      write("probe-xhr", "blocked");
    }

    try {
      let socketOpened = false;
      const socket = new WebSocket(SOCKET);
      socket.onopen = () => {
        socketOpened = true;
        write("probe-websocket", "LEAK:websocket-open");
        socket.close();
      };
      socket.onerror = () => {
        write("probe-websocket", "blocked");
      };
      socket.onclose = () => {
        // A close before it ever opened is the CSP refusal.
        if (!socketOpened) write("probe-websocket", "blocked");
      };
    } catch {
      write("probe-websocket", "blocked");
    }

    try {
      let sourceOpened = false;
      const source = new EventSource(REMOTE);
      source.onopen = () => {
        sourceOpened = true;
        write("probe-eventsource", "LEAK:eventsource-open");
        source.close();
      };
      source.onerror = () => {
        if (!sourceOpened) write("probe-eventsource", "blocked");
      };
    } catch {
      write("probe-eventsource", "blocked");
    }

    let beaconReturned = null;
    try {
      beaconReturned = navigator.sendBeacon(REMOTE, "frame");
    } catch {
      write("probe-beacon", "blocked");
    }
    if (beaconReturned === false) {
      // A false return is the engine's own "could not queue" refusal.
      write("probe-beacon", "blocked");
    } else if (beaconReturned === true) {
      // Queued: the confirmed refusal is the CSP connect-src violation, and the
      // Node-side request log (asserted separately) is the second proof.
      setTimeout(() => {
        if (violations["connect-src"]) write("probe-beacon", "blocked");
        else write("probe-beacon", "LEAK:beacon-accepted");
      }, 300);
    }

    try {
      const remoteImage = new Image();
      remoteImage.onload = () => {
        write("probe-image", "LEAK:image-loaded");
      };
      remoteImage.onerror = () => {
        write("probe-image", "blocked");
      };
      remoteImage.src = `${REMOTE}/pixel.png`;
    } catch {
      write("probe-image", "blocked");
    }

    if (window.__TAURI_INTERNALS__ || window.__TAURI__) {
      write("probe-tauri", "LEAK:tauri-present");
    } else {
      write("probe-tauri", "blocked");
    }

    try {
      // A cross-origin (opaque-origin) Frame cannot read its parent's DOM; the
      // thrown SecurityError is the confirmed refusal.
      window.parent.document;
      window.top.document;
      write("probe-parent-dom", "LEAK:parent-document");
    } catch {
      write("probe-parent-dom", "blocked");
    }
  }

  function navigateSelf(target) {
    const attempt = `<script>fetch("${REMOTE}", {mode:"no-cors"})</script>`;
    if (target === "data") {
      window.location.href = `data:text/html,${encodeURIComponent(attempt)}`;
      return;
    }
    const url = URL.createObjectURL(new Blob([attempt], { type: "text/html" }));
    window.location.href = url;
  }

  function onMessage(event) {
    const data = event.data;
    if (data === null || typeof data !== "object") return;
    if (data.kind === "pong") {
      write("pong", "pong");
      if (typeof data.lang === "string") showLanguage(data.lang);
      runProbes();
      return;
    }
    if (data.kind === "lang" && typeof data.lang === "string") {
      showLanguage(data.lang);
      return;
    }
    if (data.kind === "navigate" && typeof data.target === "string") {
      navigateSelf(data.target);
    }
  }

  // The host writes the --maibuk-* tokens onto this document's <html> (on load
  // and again on each theme change); re-read them whenever it does.
  new MutationObserver(readTokens).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["style", "class"],
  });

  // The image naturalWidth proves the hashed image loaded; the shim rewrote the
  // <img src> to an in-Frame blob: URL.
  const image = document.getElementById("hashed-image");
  if (image) {
    image.addEventListener("load", () => {
      write("image", String(image.naturalWidth));
    });
    if (image.complete && image.naturalWidth > 0) write("image", String(image.naturalWidth));
  }

  readTokens();
  const port = window.maibuk && window.maibuk.port;
  if (port) {
    port.onmessage = onMessage;
    port.start();
    port.postMessage({ kind: "ping" });
  }
})();
