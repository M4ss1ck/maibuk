// PROTOTYPE. Native engine path, loaded only inside the Tauri shell (built
// with --features dictation-spike). Rust captures with cpal and runs
// libmoonshine; this page only receives line text over a Tauri Channel.
// ?auto=1 runs one session unattended and writes a report through
// dictation_spike_report, so the run can be scripted.
import { Channel, invoke } from "@tauri-apps/api/core";

type DictationEvent =
  | { type: "partial"; id: string; text: string; sentMs: number }
  | { type: "line"; id: string; text: string; start: number; duration: number; engineLatencyMs: number; sentMs: number }
  | { type: "info"; message: string }
  | { type: "done"; summary: string };

// The Tauri dev window always opens devUrl with no query, so a scripted run
// passes its parameters through VITE_SPIKE_AUTO when starting Vite.
const params = new URLSearchParams(location.search || import.meta.env.VITE_SPIKE_AUTO || "");
const options: [string, string][] = [...params].filter(([k]) => k.startsWith("opt.")).map(([k, v]) => [k.slice(4), v]);
const bridgeMs: number[] = [];
const lines: string[] = [];
const info: string[] = [];

async function probe() {
  const out: Record<string, unknown> = {
    userAgent: navigator.userAgent,
    crossOriginIsolated,
    sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined",
    webkitSpeechRecognition: "webkitSpeechRecognition" in window || "SpeechRecognition" in window,
    webgpu: "gpu" in navigator,
    mediaDevices: !!navigator.mediaDevices?.getUserMedia,
    longtaskSupported: PerformanceObserver.supportedEntryTypes?.includes("longtask"),
    eventTimingSupported: PerformanceObserver.supportedEntryTypes?.includes("event"),
  };
  try {
    const s = await Promise.race([
      navigator.mediaDevices.getUserMedia({ audio: true }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout after 5 s (no prompt answered)")), 5000)),
    ]);
    s.getTracks().forEach((t) => t.stop());
    out.getUserMedia = "granted";
  } catch (e) {
    out.getUserMedia = `${(e as Error).name}: ${(e as Error).message}`;
  }
  return out;
}

function runNative(model: string, source: string, singleThread: boolean): Promise<string> {
  return new Promise((resolve) => {
    const ch = new Channel<DictationEvent>();
    ch.onmessage = (e) => {
      if (e.type === "partial") {
        bridgeMs.push(Date.now() - e.sentMs);
        document.getElementById("live")!.textContent = e.text;
      } else if (e.type === "line") {
        bridgeMs.push(Date.now() - e.sentMs);
        lines.push(e.text);
        const p = document.createElement("p");
        p.textContent = e.text;
        document.getElementById("transcript")!.append(p);
        document.getElementById("live")!.textContent = "";
      } else if (e.type === "info") info.push(e.message);
      else resolve(e.summary);
    };
    window.__spike.markWindow("start");
    void invoke("dictation_spike_start", { model, source, options, singleThread, onEvent: ch });
  });
}

const box = document.createElement("fieldset");
box.innerHTML = `<legend>Native engine (Tauri, Rust + libmoonshine)</legend>
  <button id="nstart">Start native (mic)</button> <button id="nstop">Stop native</button>`;
document.querySelector("fieldset")!.after(box);
let pending: Promise<string> | null = null;
document.getElementById("nstart")!.addEventListener("click", () => {
  const model = (document.getElementById("model") as HTMLSelectElement).value;
  pending = runNative(model, "mic", true);
});
document.getElementById("nstop")!.addEventListener("click", async () => {
  await invoke("dictation_spike_stop");
  const summary = await pending;
  window.__spike.markWindow("end");
  document.getElementById("stats")!.textContent = summary ?? "";
});

if (params.get("auto")) {
  const model = params.get("model") ?? "tiny-streaming-en";
  const source = params.get("source") ?? "two_cities_16k.wav";
  const singleThread = params.get("st") !== "0";
  void (async () => {
    const env = await probe();
    const typing = document.getElementById("typing") as HTMLTextAreaElement;
    typing.focus();
    const summary = await runNative(model, source, singleThread);
    window.__spike.markWindow("end");
    const sorted = [...bridgeMs].sort((a, b) => a - b);
    const report = {
      env,
      model,
      source,
      singleThread,
      options,
      native: JSON.parse(summary),
      bridgeMs: { p50: sorted[Math.floor(sorted.length / 2)] ?? null, max: sorted.at(-1) ?? null, n: sorted.length },
      page: window.__spike.summary(),
      info,
      lines,
    };
    const name = `${model}-${source.replace(/\.wav$/, "")}-st${singleThread ? 1 : 0}${params.get("tag") ?? ""}`;
    await invoke("dictation_spike_report", { name, json: JSON.stringify(report, null, 2) });
    document.title = "SPIKE DONE";
  })();
}
