// Collector for the Plugin engine probes (#407). Counts every request server-side:
// the server log, not the page's JS errors, decides whether a leak happened.
// Port 8787: collector (leak targets, controls, results). Port 8788: static probe page,
// so the page and the collector are cross-origin, as in the Tauri builds.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const outDir = path.join(here, "out");
fs.mkdirSync(outDir, { recursive: true });
const staticDir = path.resolve(here, "../../public/probe");
const requests = []; // {at, method, url, origin, ws}
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
};

const collector = http.createServer((req, res) => {
  const url = req.url;
  if (req.method !== "OPTIONS" && !url.startsWith("/result")) {
    requests.push({ at: Date.now(), method: req.method, url, origin: req.headers.origin ?? null });
  }
  if (req.method === "OPTIONS") return res.writeHead(204, cors).end();
  if (url.startsWith("/result") && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const result = JSON.parse(body);
      const run = result.run;
      const seen = requests.filter((r) => r.url.includes(`/${run}/`));
      const file = path.join(outDir, `${run}.json`);
      const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
      const merged = { ...prev, ...result, serverSeen: seen };
      fs.writeFileSync(file, JSON.stringify(merged, null, 2));
      console.log(`[result] ${run} part=${result.part} -> ${file}`);
      res.writeHead(200, cors).end("ok");
    });
    return;
  }
  if (url.includes("/sse")) {
    res.writeHead(200, { ...cors, "content-type": "text/event-stream" });
    return res.end("data: hi\n\n");
  }
  if (url.endsWith(".js") || url.includes("/import") || url.includes("/importScripts")) {
    res.writeHead(200, { ...cors, "content-type": "text/javascript" });
    return res.end("/* probe */");
  }
  res.writeHead(200, { ...cors, "content-type": "text/plain" }).end("ok");
});
collector.on("upgrade", (req, socket) => {
  requests.push({ at: Date.now(), method: "UPGRADE", url: req.url, origin: req.headers.origin ?? null, ws: true });
  socket.destroy();
});
collector.listen(8787, "127.0.0.1", () => console.log("collector :8787"));

const types = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json" };
http
  .createServer((req, res) => {
    const p = path.join(staticDir, decodeURIComponent(req.url.split("?")[0].replace(/^\/probe\//, "/")));
    if (!p.startsWith(staticDir) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": types[path.extname(p)] ?? "application/octet-stream" });
    fs.createReadStream(p).pipe(res);
  })
  .listen(8788, "127.0.0.1", () => console.log("static :8788 -> " + staticDir));
