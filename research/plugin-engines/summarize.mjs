// Turns collector output into per-engine verdicts. T1 is decided by what the server
// received: a kind passes when the control frame reached the server and the CSP frame did not.
import fs from "node:fs";
const KINDS = { fetch: "fetch", xhr: "xhr", websocket: "websocket", eventsource: "sse", importScripts: "importScripts.js", dynamicImport: "import.js", nestedDataWorker: "nested-data", nestedBlobWorker: "nested-blob", sendBeacon: "beacon" };
const files = process.argv.slice(2);
const summary = [];
for (const f of files) {
  const r = JSON.parse(fs.readFileSync(f, "utf8"));
  const seen = (r.serverSeen ?? []).map((s) => s.url);
  const hit = (variant, path) => seen.some((u) => u.endsWith(`/${variant}/${path}`));
  const out = { run: r.run, engine: r.engine, ua: r.ua };
  if (r.t1) {
    const kinds = {};
    for (const [k, p] of Object.entries(KINDS)) {
      const control = hit("control", p), csp = hit("csp", p);
      kinds[k] = { controlReached: control, cspReached: csp, verdict: csp ? "LEAK" : control ? "blocked" : "inconclusive (control did not reach)" };
    }
    out.t1 = { mainFetch: r.t1.mainFetch, kinds, violationsInWorker: r.t1.cspFrame?.worker?.violations?.length ?? 0,
      pass: !Object.values(kinds).some((k) => k.cspReached) };
  }
  if (r.t2) out.t2 = r.t2;
  if (r.t3) {
    const groups = {};
    for (const x of r.t3.results) (groups[`${x.rows}/${x.delay}/${x.echo ?? "last"}`] ??= []).push(x);
    out.t3 = Object.entries(groups).map(([k, xs]) => {
      const med = (a) => [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)];
      return { "rows/delay/echo": k, p50_median: med(xs.map((x) => x.p50)), p95_median: med(xs.map((x) => x.p95)), p95_worst: Math.max(...xs.map((x) => x.p95)),
        max: Math.max(...xs.map((x) => x.max)), startup: [Math.min(...xs.map((x) => x.startupMs)), Math.max(...xs.map((x) => x.startupMs))],
        finalOk: `${xs.filter((x) => x.finalOk).length}/${xs.length}`, catchUpMax: Math.max(...xs.map((x) => x.catchUpMs)) };
    });
  }
  summary.push(out);
}
console.log(JSON.stringify(summary, null, 1));
