// T3: Remote DOM keystroke echo, same shape as the #391 prototype. The driver sets the
// input's value through the native setter and dispatches `input` (no Playwright in a
// Tauri webview), so latency is host onChange -> host layout effect seeing the echo.
import { ThreadWebWorker } from "@quilted/threads";
import { createRemoteComponentRenderer, RemoteReceiver, RemoteRootRenderer } from "@remote-dom/react/host";
import { useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

const SENTENCE = "The quick brown fox jumps over the lazy dog while the writer keeps going";
let sent = new Map<string, number>();
let samples: number[] = [];
let firstCommit: (() => void) | null = null;
let echoMode: "last" | "inflight" = "last";
const inflight: string[] = [];
let echoWaiter: { value: string; resolve: () => void } | null = null;

const TextField = createRemoteComponentRenderer(function TextField({ value, label, onInput }: any) {
  const [local, setLocal] = useState("");
  const lastSent = useRef("");
  useLayoutEffect(() => {
    firstCommit?.();
    firstCommit = null;
  }, []);
  useLayoutEffect(() => {
    if (value == null) return;
    const t0 = sent.get(value);
    if (t0 != null) {
      samples.push(performance.now() - t0);
      sent.delete(value);
    }
    if (echoWaiter && value === echoWaiter.value) echoWaiter.resolve();
    if (echoMode === "last") {
      if (value !== lastSent.current) setLocal(value); // #391 rule: host owns the live value
    } else {
      // Every value still in flight is an echo; drop it and everything sent before it.
      const i = inflight.indexOf(value);
      if (i >= 0) inflight.splice(0, i + 1);
      else setLocal(value);
    }
  }, [value]);
  return (
    <label>
      {label}{" "}
      <input
        id="t3-input"
        value={local}
        onChange={(e) => {
          const v = e.target.value;
          setLocal(v);
          lastSent.current = v;
          inflight.push(v);
          sent.set(v, performance.now());
          onInput?.(v);
        }}
      />
    </label>
  );
});
const Text = createRemoteComponentRenderer(function Text({ children }: any) {
  return <span>{children}</span>;
});
const ListItem = createRemoteComponentRenderer(function ListItem({ label }: any) {
  return <li>{label}</li>;
});
const components = new Map<string, any>([
  ["ui-text-field", TextField],
  ["ui-text", Text],
  ["ui-list-item", ListItem],
]);

const setNative = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pct = (xs: number[], p: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return +s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)].toFixed(2);
};

async function runCase(rows: number, delay: number, mode: "last" | "inflight") {
  echoMode = mode;
  inflight.length = 0;
  sent = new Map();
  samples = [];
  const mount = document.createElement("div");
  document.getElementById("t3")!.appendChild(mount);
  const receiver = new RemoteReceiver();
  const t0 = performance.now();
  const committed = new Promise<void>((r) => (firstCommit = r));
  const worker = new Worker(new URL("./t3-worker.js", location.href));
  const thread = ThreadWebWorker.from(worker) as any;
  const root = createRoot(mount);
  root.render(<RemoteRootRenderer receiver={receiver} components={components} />);
  thread.imports.render(receiver.connection, rows);
  await committed;
  const startupMs = +(performance.now() - t0).toFixed(1);
  await wait(300);
  const input = mount.querySelector("input")!;
  let typed = "";
  for (const ch of SENTENCE) {
    typed += ch;
    setNative.call(input, typed);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(delay);
  }
  const typedAt = performance.now();
  const caughtUp = await Promise.race([
    new Promise<boolean>((r) => {
      if (!sent.has(SENTENCE) && samples.length) return r(true);
      echoWaiter = { value: SENTENCE, resolve: () => r(true) };
    }),
    wait(15000).then(() => false),
  ]);
  echoWaiter = null;
  const catchUpMs = +(performance.now() - typedAt).toFixed(1);
  const finalOk = input.value === SENTENCE;
  const res = {
    rows,
    delay,
    echo: mode,
    startupMs,
    n: samples.length,
    p50: pct(samples, 50),
    p95: pct(samples, 95),
    max: samples.length ? +Math.max(...samples).toFixed(2) : null,
    caughtUp,
    catchUpMs,
    finalOk,
  };
  root.unmount();
  worker.terminate();
  mount.remove();
  return res;
}

(window as any).__runT3 = async () => {
  const probe = (window as any).__probe;
  const results = [];
  for (const rows of [0, 200, 1000]) {
    for (const [delay, mode] of [[100, "last"], [0, "last"], [0, "inflight"]] as const) {
      for (let rep = 0; rep < 3; rep++) {
        const r = await runCase(rows, delay, mode);
        probe.log(`T3 rows=${rows} delay=${delay} echo=${mode} rep=${rep}: p50 ${r.p50} p95 ${r.p95} max ${r.max} start ${r.startupMs} catchup ${r.catchUpMs} ok ${r.finalOk}`);
        results.push({ ...r, rep });
      }
    }
  }
  await probe.post("t3", { method: "native-setter input events", results });
  probe.log("T3 posted");
};
