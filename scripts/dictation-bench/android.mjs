#!/usr/bin/env node
// Runs the Dictation Interpreter bench in Chrome on the Android device adb
// sees (a phone or an emulator), then checks it against the ADR 0015 budget.
//
//   pnpm bench:dictation:android [output.json]
//
// Bundles src/test/bench/dictation-interpreter.browser.ts, serves it on a
// cross-origin-isolated localhost page (so performance.now() is fine-grained),
// forwards the port with `adb reverse`, opens it in Chrome, and waits for the
// page to post its results.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { printBudgetReport } from "../dictation-bench-budget.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = Number(process.env.DICTATION_BENCH_PORT ?? 4789);
const TIMEOUT_MS = 180_000;
const outPath = process.argv[2];

function adb(...args) {
  const result = spawnSync("adb", args, { encoding: "utf8" });
  if (result.error) throw new Error(`adb not found: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`adb ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

const devices = adb("devices")
  .split("\n")
  .slice(1)
  .filter((line) => line.endsWith("\tdevice"));
if (devices.length !== 1) {
  console.error(`Expected exactly one adb device, found ${devices.length}. Set ANDROID_SERIAL.`);
  if (!process.env.ANDROID_SERIAL) process.exit(2);
}
if (spawnSync("adb", ["shell", "pm", "path", "com.android.chrome"]).status !== 0) {
  console.error("Chrome (com.android.chrome) is not installed on the device.");
  process.exit(2);
}
const model = adb("shell", "getprop", "ro.product.model");
const abi = adb("shell", "getprop", "ro.product.cpu.abi");

const output = await build({
  configFile: false,
  logLevel: "warn",
  resolve: { alias: { "@": resolve(ROOT, "src") } },
  build: {
    write: false,
    minify: true,
    lib: {
      entry: resolve(ROOT, "src/test/bench/dictation-interpreter.browser.ts"),
      formats: ["es"],
      fileName: "bench",
    },
  },
});
const bundle = [output].flat()[0].output.find((chunk) => chunk.type === "chunk").code;

const page = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Dictation Interpreter bench</title><pre id="status">Running…</pre>
<script type="module" src="/bench.js"></script>`;
const isolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cache-Control": "no-store",
};

const report = await new Promise((resolveReport, reject) => {
  const timer = setTimeout(
    () => reject(new Error("No result from the device in time.")),
    TIMEOUT_MS
  );
  const server = createServer((req, res) => {
    if (req.method === "POST" && req.url === "/result") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        res.writeHead(204).end();
        clearTimeout(timer);
        server.close();
        resolveReport(JSON.parse(body));
      });
      return;
    }
    if (req.url === "/bench.js") {
      res.writeHead(200, { ...isolation, "Content-Type": "text/javascript" }).end(bundle);
      return;
    }
    res.writeHead(200, { ...isolation, "Content-Type": "text/html" }).end(page);
  });
  server.listen(PORT, "127.0.0.1", () => {
    adb("reverse", `tcp:${PORT}`, `tcp:${PORT}`);
    adb(
      "shell",
      "am",
      "start",
      "-a",
      "android.intent.action.VIEW",
      "-d",
      `http://localhost:${PORT}/?t=${Date.now()}`,
      "com.android.chrome"
    );
    console.log(`Running in Chrome on ${model} (${abi})…`);
  });
});

adb("reverse", "--remove", `tcp:${PORT}`);
if (report.error) {
  console.error(`The page failed: ${report.error}`);
  process.exit(1);
}
report.environment = { ...report.environment, model, abi };
if (outPath) {
  mkdirSync(dirname(resolve(outPath)), { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2));
}

console.log(`\nUser agent: ${report.environment.userAgent}`);
console.log(`Cross-origin isolated timers: ${report.environment.crossOriginIsolated}`);
process.exit(printBudgetReport(report, ` on ${model} (${abi})`) ? 0 : 1);
