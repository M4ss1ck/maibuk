// Plugin engine probes for #407 (T1: CSP reaches the blob Worker; T2: Tauri IPC from a
// sandboxed frame). T3 lives in t3-host.js. Results go to the collector, which also
// counts every request it receives; the server log decides T1, never the JS errors.
(() => {
  const params = new URLSearchParams(location.search);
  const COLLECTOR = params.get("collector") ?? "http://127.0.0.1:8787";
  const ua = navigator.userAgent;
  const engine = /Android/.test(ua)
    ? "android-webview"
    : window.__TAURI_INTERNALS__
      ? "tauri-" + (/AppleWebKit/.test(ua) && !/Chrome/.test(ua) ? "webkitgtk" : "chromium")
      : /Firefox/.test(ua)
        ? "firefox"
        : /Chrome/.test(ua)
          ? "chromium"
          : "webkit";
  const RUN = params.get("run") ?? `${engine}-${Date.now()}`;
  const only = (params.get("only") ?? "t1,t2,t3").split(",");
  const log = (line) => {
    document.getElementById("log").textContent += line + "\n";
  };
  window.__probe = { RUN, COLLECTOR, engine, log, post };

  async function post(part, data) {
    const body = JSON.stringify({ run: RUN, engine, ua, href: location.href, part, [part]: data });
    try {
      await fetch(`${COLLECTOR}/result`, { method: "POST", body });
    } catch (e) {
      log(`post failed: ${e}`);
    }
  }

  // ---------- T1 ----------
  // Worker source: every network path a Plugin could try. Each target URL carries the
  // run and variant so the collector can attribute what arrived.
  const workerSource = (base) => `
    const base = ${JSON.stringify(base)};
    const out = { attempts: {}, violations: [] };
    self.addEventListener("securitypolicyviolation", (e) =>
      out.violations.push({ directive: e.violatedDirective || e.effectiveDirective, blocked: e.blockedURI }));
    const attempt = async (kind, fn) => {
      try { await fn(); out.attempts[kind] = "no-error"; }
      catch (e) { out.attempts[kind] = "error: " + (e && (e.name + " " + e.message)); }
    };
    (async () => {
      out.tauriInWorker = typeof self.__TAURI_INTERNALS__;
      await attempt("fetch", () => fetch(base + "fetch"));
      await attempt("xhr", () => new Promise((res, rej) => {
        const x = new XMLHttpRequest(); x.open("GET", base + "xhr");
        x.onload = res; x.onerror = () => rej(new Error("xhr onerror")); x.send(); }));
      await attempt("websocket", () => new Promise((res, rej) => {
        const ws = new WebSocket(base.replace(/^http/, "ws") + "websocket");
        ws.onopen = res; ws.onerror = () => rej(new Error("ws onerror")); ws.onclose = () => rej(new Error("ws closed")); }));
      await attempt("eventsource", () => new Promise((res, rej) => {
        if (typeof EventSource === "undefined") return rej(new Error("no EventSource in worker"));
        const es = new EventSource(base + "sse"); es.onmessage = () => { es.close(); res(); };
        es.onerror = () => { es.close(); rej(new Error("es onerror")); }; }));
      await attempt("sendBeacon", () => {
        if (!self.navigator.sendBeacon) throw new Error("no sendBeacon in worker");
        if (!navigator.sendBeacon(base + "beacon", "x")) throw new Error("sendBeacon returned false"); });
      await attempt("importScripts", () => importScripts(base + "importScripts.js"));
      await attempt("dynamicImport", () => import(base + "import.js"));
      await attempt("nestedDataWorker", () => new Promise((res, rej) => {
        const w = new Worker("data:text/javascript," + encodeURIComponent("fetch(" + JSON.stringify(base + "nested-data") + ").then(()=>postMessage('ok'),e=>postMessage('err '+e))"));
        w.onmessage = (m) => (m.data === "ok" ? res() : rej(new Error(m.data))); w.onerror = (e) => { e.preventDefault && e.preventDefault(); rej(new Error("worker error " + (e.message || ""))); }; }));
      await attempt("nestedBlobWorker", () => new Promise((res, rej) => {
        const u = URL.createObjectURL(new Blob(["fetch(" + JSON.stringify(base + "nested-blob") + ").then(()=>postMessage('ok'),e=>postMessage('err '+e))"], { type: "text/javascript" }));
        const w = new Worker(u);
        w.onmessage = (m) => (m.data === "ok" ? res() : rej(new Error(m.data))); w.onerror = (e) => { e.preventDefault && e.preventDefault(); rej(new Error("worker error " + (e.message || ""))); }; }));
      setTimeout(() => postMessage(out), 300);
    })();
  `;

  const T1_CSP = "default-src 'none'; script-src 'unsafe-inline' blob:; worker-src blob:; connect-src 'none'";

  function frameDoc(csp, script) {
    const meta = csp ? `<meta http-equiv="Content-Security-Policy" content="${csp}">` : "";
    return `<!doctype html><html><head>${meta}</head><body><script>${script}<\/script></body></html>`;
  }

  function runFrame(srcdoc, timeoutMs = 15000) {
    return new Promise((resolve) => {
      const iframe = document.createElement("iframe");
      iframe.setAttribute("sandbox", "allow-scripts");
      iframe.style.display = "none";
      const done = (v) => {
        window.removeEventListener("message", onMessage);
        clearTimeout(timer);
        iframe.remove();
        resolve(v);
      };
      const onMessage = (e) => {
        if (e.source === iframe.contentWindow) done(e.data);
      };
      const timer = setTimeout(() => done({ timeout: true }), timeoutMs);
      window.addEventListener("message", onMessage);
      iframe.srcdoc = srcdoc;
      document.body.appendChild(iframe);
    });
  }

  function t1Variant(variant, csp) {
    const base = `${COLLECTOR}/leak/${RUN}/${variant}/`;
    const script = `
      const out = { frameOrigin: String(self.origin), frameViolations: [] };
      document.addEventListener("securitypolicyviolation", (e) => out.frameViolations.push({ directive: e.violatedDirective, blocked: e.blockedURI }));
      try {
        const url = URL.createObjectURL(new Blob([${JSON.stringify(workerSource(base))}], { type: "text/javascript" }));
        const w = new Worker(url);
        w.onmessage = (m) => { out.worker = m.data; parent.postMessage(out, "*"); };
        w.onerror = (e) => { out.workerError = String(e.message || e); parent.postMessage(out, "*"); };
      } catch (e) { out.workerCreateError = String(e); parent.postMessage(out, "*"); }
    `;
    return runFrame(frameDoc(csp, script));
  }

  async function t1() {
    log("T1: control fetch from the main document");
    let mainFetch;
    try {
      await fetch(`${COLLECTOR}/control/${RUN}/main/fetch`);
      mainFetch = "ok";
    } catch (e) {
      mainFetch = String(e);
    }
    log("T1: control frame (sandboxed, no CSP)");
    const control = await t1Variant("control", null);
    log("T1: CSP frame (sandboxed, connect-src 'none')");
    const csp = await t1Variant("csp", T1_CSP);
    await new Promise((r) => setTimeout(r, 1500)); // late requests (beacon) reach the server
    const data = { csp: T1_CSP, mainFetch, control, cspFrame: csp };
    await post("t1", data);
    log("T1 posted");
  }

  // ---------- T2 ----------
  const t2Script = (MARK) => `
    const MARK = ${JSON.stringify(MARK)};
    (async () => {
      const out = { origin: String(self.origin), href: location.href };
      const ti = window.__TAURI_INTERNALS__;
      out.tauriInternals = typeof ti;
      out.windowIpc = typeof window.ipc;
      out.webkitIpcHandler = typeof (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.ipc);
      out.chromeWebview = typeof (window.chrome && window.chrome.webview);
      // The reply may be delivered only to the main frame, so each call gets a timeout and a
      // side effect the top document can check afterwards (the marker table).
      const call = async (cmd, args) => {
        try { return { ok: true, value: await Promise.race([ti.invoke(cmd, args), new Promise((_, rej) => setTimeout(() => rej(new Error("no reply in 3 s")), 3000))]) }; }
        catch (e) { return { ok: false, error: String(e && (e.message || e)) }; }
      };
      if (ti) {
        out.sqlSelect = await call("plugin:sql|select", { db: "sqlite:maibuk.db", query: "SELECT count(*) AS n FROM books", values: [] });
        out.sqlExecuteMarker = await call("plugin:sql|execute", { db: "sqlite:maibuk.db", query: "CREATE TABLE IF NOT EXISTS probe_t2_marker_" + MARK + " (x)", values: [] });
      }
      // Raw IPC without the invoke key: Tauri must drop it (stderr: "__TAURI_INVOKE_KEY__ expected ... but received probe-guessed-key").
      const raw = JSON.stringify({ cmd: "plugin:os|hostname", callback: 1, error: 2, payload: {}, options: null, __TAURI_INVOKE_KEY__: "probe-guessed-key" });
      const handler = (window.ipc && window.ipc.postMessage && window.ipc) || (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.ipc);
      if (handler) { try { handler.postMessage(raw); out.rawPost = "posted"; } catch (e) { out.rawPost = "threw " + e; } }
      else out.rawPost = "no handler";
      for (const u of ["ipc://localhost/plugin%3Aos%7Chostname", "http://ipc.localhost/plugin%3Aos%7Chostname"]) {
        try {
          const r = await fetch(u, { method: "POST", body: "{}", headers: { "Content-Type": "application/json", "Tauri-Callback": "1", "Tauri-Error": "2", "Tauri-Invoke-Key": "probe-guessed-key" } });
          out["rawFetch " + u] = r.status + " " + (await r.text()).slice(0, 120);
        } catch (e) { out["rawFetch " + u] = "error " + e; }
      }
      try {
        const w = new Worker(URL.createObjectURL(new Blob(["postMessage({ti: typeof self.__TAURI_INTERNALS__, ipc: typeof self.ipc})"])));
        out.worker = await new Promise((r) => { w.onmessage = (m) => r(m.data); w.onerror = (e) => r({ error: String(e.message) }); });
      } catch (e) { out.worker = { error: String(e) }; }
      parent.postMessage(out, "*");
    })();
  `;

  async function t2() {
    const top = { tauriInternals: typeof window.__TAURI_INTERNALS__ };
    if (window.__TAURI_INTERNALS__) {
      const ti = window.__TAURI_INTERNALS__;
      const call = async (cmd, args) => {
        try {
          return { ok: true, value: await ti.invoke(cmd, args) };
        } catch (e) {
          return { ok: false, error: String(e?.message ?? e) };
        }
      };
            top.sqlSelect = await call("plugin:sql|select", { db: "sqlite:maibuk.db", query: "SELECT count(*) AS n FROM books", values: [] });
    }
    log("T2: sandboxed frame, no CSP");
    const plain = await runFrame(frameDoc(null, t2Script("plain")), 20000);
    log("T2: sandboxed frame with the T1 CSP");
    const withCsp = await runFrame(frameDoc(T1_CSP, t2Script("csp")), 20000);
    if (window.__TAURI_INTERNALS__) {
      // Did the frame's execute run, even if its reply never came back?
      try {
        top.markersAfterFrames = await window.__TAURI_INTERNALS__.invoke("plugin:sql|select", { db: "sqlite:maibuk.db", query: "SELECT name FROM sqlite_master WHERE name LIKE 'probe_t2_marker_%'", values: [] });
      } catch (e) { top.markersAfterFrames = "error " + e; }
    }
    await post("t2", { top, frame: plain, frameWithCsp: withCsp });
    log("T2 posted");
  }

  window.addEventListener("load", async () => {
    log(`run ${RUN} (${engine})`);
    if (only.includes("t1")) await t1();
    if (only.includes("t2")) await t2();
    if (only.includes("t3") && window.__runT3) await window.__runT3();
    await post("done", { at: new Date().toISOString() });
    log("ALL DONE");
    document.title = "probe done";
  });
})();
