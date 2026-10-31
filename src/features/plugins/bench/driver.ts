/**
 * The Plugins bench in-app driver (issue #448).
 *
 * The WebKitGTK half of `bench:plugins` cannot use Playwright (its WebKit is
 * not the WebKitGTK build the shell ships), so it drives the **real Tauri
 * Linux binary** instead. `main.tsx` imports this module dynamically only in a
 * build made with `VITE_PLUGIN_BENCH_DRIVER=1`, after the seed was read and its
 * approvals written (`seed.ts`) and after the Plugin lifecycle was installed.
 *
 * There is no Playwright here, so the interplay is synthetic: navigation goes
 * through `history.pushState` (the app uses `BrowserRouter`, which reacts to
 * `popstate`), a Shortcut is a dispatched `KeyboardEvent`, and typing is a
 * `keydown` plus a native-setter value write plus an `input` event plus
 * `keyup` — the same things Playwright would do. Every sample posts to the
 * runner's collector (the same `node:http` shell the conformance lane reuses).
 *
 * This module is measurement plumbing, like `ConformancePage.tsx` for the
 * conformance lane: the pure pieces it stands on (`measure.ts`) carry the unit
 * tests.
 */

import { BENCH_COLLECTOR_PATHS } from "@/features/plugins/bench/protocol";
import {
  dispatchShortcut,
  dispatchTypingKey,
  ECHO_WARMUP_KEYS,
  type EchoSamples,
  echoTextArrived,
  echoWarmupText,
  findEchoElement,
  findEchoInput,
  GALLERY_MARK,
  matchEchoSamples,
  type EchoMutation,
  parseChord,
  pluginStartMeasure,
  pollFor,
  readMarkStart,
  readMeasureDuration,
} from "@/features/plugins/bench/measure";
import { getPluginsBenchSeed } from "@/features/plugins/bench/seed";
import type { PluginsBenchSeed } from "@/features/plugins/bench/types";

/** How long a single measurement may take before the lane gives up. */
const MEASURE_TIMEOUT_MS = 45_000;
/** How long a Plugin may take to become ready before the lane gives up. */
const READY_TIMEOUT_MS = 30_000;
/** The echo page's full tree (1,000 rows); the measurement waits for it. */
const ROW_SENTINEL = "Row 1000";
/** The echo typing pace: 120 ms for echo, 0 for a burst. */
const ECHO_PACE_MS = 120;
/**
 * The notification throttle admits one call every 5 s, so two `stamp` presses
 * need this gap between them (the 2 s toast is gone well before).
 */
const STAMP_GAP_MS = 5_300;
/** The first visible effect of `stamp`: the notification the fixture shows. */
const STAMP_EFFECT = "Fixture stamped";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Navigates the app the way `BrowserRouter` observes (pushState + popstate). */
function navigateTo(to: string): void {
  window.history.pushState({}, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/**
 * Closes any modal (the first-launch Tutorial offer), which hides the Shortcut
 * listeners the command measurement needs. Escape is the Modal's own dismiss.
 */
async function closeOverlays(): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const dialog = document.querySelector('[role="dialog"]');
    if (dialog === null) return;
    const target = document.activeElement ?? dialog;
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        bubbles: true,
        cancelable: true,
      })
    );
    await sleep(100);
  }
}

/** POSTs one payload to the collector; a missing or slow collector never breaks the app. */
async function post(seed: PluginsBenchSeed, path: string, body?: unknown): Promise<void> {
  try {
    await fetch(`${seed.collectorUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // The runner records a collector failure as unmeasured; the app stays up.
  }
}

/** A short description of the app's Plugin and route state, for a failed run. */
async function diagnosePlugins(seed: PluginsBenchSeed): Promise<string> {
  const parts = [
    `mode=${seed.mode}`,
    `approvals=${seed.approvals.map((a) => a.pluginId).join(",")}`,
    `path=${window.location.pathname}`,
    `dialogs=${document.querySelectorAll('[role="dialog"]').length}`,
    `statuses=${document.querySelectorAll('[role="status"]').length}`,
  ];
  try {
    const { getPluginDirectory } = await import("@/lib/platform");
    const directory = await getPluginDirectory();
    const folders = await directory.listFolders();
    parts.push(`kind=${directory.kind}`, `folders=${folders.join(",")}`);
    for (const folder of folders) {
      const read = await directory.readFolder(folder);
      parts.push(`${folder}:hash=${read?.hash ?? "none"}`);
    }
  } catch (error) {
    parts.push(`directory-error=${error instanceof Error ? error.message : String(error)}`);
  }
  return parts.join(" ");
}

/**
 * Arms a MutationObserver and runs `arm`; resolves with the `performance.now()`
 * of the next rAF after a `[role="status"]` carrying `effect` first appears.
 */
function firstVisibleEffect(effect: string, arm: () => void): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const observer = new MutationObserver(() => {
      const toast = [...document.querySelectorAll('[role="status"]')].find((element) =>
        element.textContent?.includes(effect)
      );
      if (!toast) return;
      observer.disconnect();
      clearTimeout(timer);
      requestAnimationFrame(() => resolve(performance.now()));
    });
    const timer = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`the "${effect}" effect never appeared`));
    }, 15_000);
    observer.observe(document.body, { childList: true, subtree: true });
    arm();
  });
}

/** One `stamp` press: keydown to the next rAF after the notification shows. */
async function pressStamp(chord: ReturnType<typeof parseChord>): Promise<number> {
  const target = document.activeElement ?? document.body;
  const started = performance.now();
  const effectAt = await firstVisibleEffect(STAMP_EFFECT, () => dispatchShortcut(target, chord));
  return effectAt - started;
}

function stampChordOf(seed: PluginsBenchSeed): ReturnType<typeof parseChord> {
  return parseChord(seed.stampShortcut ?? "Mod+Alt+e");
}

/** Resolves once a Plugin's `plugin.start:<id>` measure exists. */
function waitForPluginReady(pluginId: string): Promise<number> {
  return pollFor(() => readMeasureDuration(pluginStartMeasure(pluginId)), {
    timeoutMs: READY_TIMEOUT_MS,
    sleep,
  });
}

/** Waits until the echo page's input and its echo Text are both in the DOM. */
async function waitForEchoPage(): Promise<{ input: HTMLInputElement; element: Element }> {
  return pollFor(
    () => {
      const input = findEchoInput(document);
      const element = findEchoElement(document);
      const row = document.body.textContent?.includes(ROW_SENTINEL) ?? false;
      if (input === null || element === null || !row) return null;
      return { input, element };
    },
    { timeoutMs: READY_TIMEOUT_MS, sleep }
  );
}

/**
 * Types `text` into the echo field, one synthetic keystroke per character, and
 * returns one keydown->echo-commit sample per key. `pace` is the gap between
 * keys: 120 ms for echo, 0 for the burst. Before sampling it types
 * `ECHO_WARMUP_KEYS` warm-up characters, waits for their echo, then clears the
 * field through the native setter + `input` path, so a cold first keystroke
 * (JIT, the first Remote UI update) does not decide p95 (issue #448). When the
 * full typed text never echoes within the timeout the text is lost: that is a
 * budget miss (exit 1), not "cannot measure", so it is recorded in `textLost`
 * and the samples gathered before the loss still count.
 */
async function measureEcho(
  input: HTMLInputElement,
  element: Element,
  text: string,
  pace: number
): Promise<EchoSamples> {
  const keys: number[] = [];
  const mutations: EchoMutation[] = [];
  let textLost = false;
  const observer = new MutationObserver(() => {
    mutations.push({ t: performance.now(), text: element.textContent ?? "" });
  });
  observer.observe(element, { childList: true, characterData: true, subtree: true });
  input.focus();
  try {
    const warmup = echoWarmupText();
    for (let i = 0; i < warmup.length; i += 1) {
      keys.push(performance.now());
      dispatchTypingKey(input, warmup[i], warmup.slice(0, i + 1));
      await sleep(pace);
    }
    await pollFor(() => (element.textContent === `echo:${warmup}` ? true : null), {
      timeoutMs: MEASURE_TIMEOUT_MS,
      sleep,
    });
    // Clear the field (select all + Backspace) through the same native-setter +
    // input path a keystroke uses, then wait for the echo to read "echo:".
    dispatchTypingKey(input, "Backspace", "");
    await pollFor(() => (element.textContent === "echo:" ? true : null), {
      timeoutMs: MEASURE_TIMEOUT_MS,
      sleep,
    });
    // Drop the warm-up's echoes: the measured phase starts from the clear.
    mutations.length = 0;

    for (let i = 0; i < text.length; i += 1) {
      keys.push(performance.now());
      dispatchTypingKey(input, text[i], text.slice(0, i + 1));
      await sleep(pace);
    }
    try {
      await pollFor(() => (echoTextArrived(mutations, text) ? true : null), {
        timeoutMs: MEASURE_TIMEOUT_MS,
        sleep,
      });
    } catch {
      // The full text never echoed: record the loss and keep the samples so far.
      textLost = true;
    }
  } finally {
    observer.disconnect();
  }
  return { samples: matchEchoSamples(keys, mutations, text, ECHO_WARMUP_KEYS), textLost };
}

async function measureLaunch(): Promise<number[]> {
  const start = await pollFor(() => readMarkStart(GALLERY_MARK), {
    timeoutMs: READY_TIMEOUT_MS,
    sleep,
  });
  return [start];
}

async function measureStartToReady(seed: PluginsBenchSeed): Promise<number[]> {
  const target = seed.startToReady;
  if (target === undefined) throw new Error("startToReady has no target");
  await closeOverlays();
  navigateTo(`/plugin/${target.pluginId}/${target.pageId}`);
  const duration = await waitForPluginReady(target.pluginId);
  return [duration];
}

async function measureCommand(seed: PluginsBenchSeed): Promise<number[]> {
  const pluginId = "fixture-everything";
  await waitForPluginReady(pluginId);
  await closeOverlays();
  // The Book editor route puts a Book in the Command's target context, so the
  // target `stamp` Command is enabled; the id need not resolve to a Book
  // (the Plugin reads `null` and names the kind), so the Library stays empty.
  navigateTo("/book/plugins-bench");
  await sleep(500);
  await closeOverlays();
  const chord = stampChordOf(seed);
  const samples: number[] = [];
  for (let i = 0; i < seed.samples; i += 1) {
    samples.push(await pressStamp(chord));
    if (i < seed.samples - 1) await sleep(STAMP_GAP_MS);
  }
  return samples;
}

async function measureRemoteUi(seed: PluginsBenchSeed, pace: number): Promise<EchoSamples> {
  const text = seed.echoText ?? "";
  await closeOverlays();
  navigateTo("/plugin/fixture-bench/echo");
  const { input, element } = await waitForEchoPage();
  return measureEcho(input, element, text, pace);
}

async function runMode(seed: PluginsBenchSeed): Promise<EchoSamples> {
  switch (seed.mode) {
    case "launch":
      return { samples: await measureLaunch(), textLost: false };
    case "startToReady":
      return { samples: await measureStartToReady(seed), textLost: false };
    case "commandToEffect":
      return { samples: await measureCommand(seed), textLost: false };
    case "remoteUiEcho":
      return measureRemoteUi(seed, ECHO_PACE_MS);
    case "remoteUiBurst":
      return measureRemoteUi(seed, 0);
    default: {
      const unreachable: never = seed.mode;
      throw new Error(`unknown bench mode ${String(unreachable)}`);
    }
  }
}

/**
 * Runs the seeded measurement once and posts it, then `/done`. `main.tsx`
 * calls this fire-and-forget after the lifecycle is installed; the runner
 * reads `/done` and kills the process.
 */
export async function runPluginsBenchDriver(): Promise<void> {
  const seed = getPluginsBenchSeed();
  if (seed === null) return;
  let result: EchoSamples = { samples: [], textLost: false };
  let error: string | undefined;
  try {
    result = await runMode(seed);
  } catch (thrown) {
    error = thrown instanceof Error ? thrown.message : String(thrown);
    console.warn(`[plugins-bench] ${seed.mode} failed`, thrown);
    error = `${error} | ${await diagnosePlugins(seed)}`;
  }
  await post(seed, BENCH_COLLECTOR_PATHS.measure, {
    mode: seed.mode,
    samples: result.samples,
    ...(result.textLost ? { textLost: true } : {}),
    ...(error !== undefined ? { error } : {}),
  });
  await post(seed, BENCH_COLLECTOR_PATHS.done);
}
