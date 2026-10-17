/**
 * The Android step's check (issue #517): evaluates a built Plugin's bundle in the
 * Android QuickJS engine the way the app runs it, with the Android global set,
 * and turns the runner's outcome into a readable failure. The runner is the
 * same `runQuickJsPlugin` the app uses (src/features/plugins/quickjs), so the
 * check cannot drift from the engine.
 *
 * Two runs, because the runner reports one error string for every failure:
 * 1. Evaluate the entry alone (no init event). An error here is the module
 *    itself: a missing global, or a syntax or top-level error.
 * 2. Evaluate and deliver the init event. An error here, with run 1 clean, is
 *    the Plugin's setup throwing.
 *
 * The QuickJS runner loads only when this check runs, so the CLI's own module
 * load stays light.
 */
import type { PluginManifest } from "@/features/plugins/types";
import { PLUGIN_INIT_MESSAGE } from "@/plugin-sdk/protocol";
import type { QuickJsRunOutcome } from "@/features/plugins/quickjs";

/** The globals the Android engine provides (src/features/plugins/quickjs/globals.ts). */
const ANDROID_GLOBALS = [
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "queueMicrotask",
  "performance",
  "URL",
  "TextEncoder",
  "TextDecoder",
  "console",
];

/** A run that did not settle in time; the runner itself has no deadline. */
const RUN_TIMEOUT_MS = 10_000;

/** A run's outcome, or a timeout the check adds on top of the runner's three. */
type SettledRun = QuickJsRunOutcome | { kind: "timeout" };

/** What the check found: whether the Plugin passes, and the lines to print. */
export interface AndroidCheckResult {
  ok: boolean;
  details: string[];
}

export interface AndroidCheckInput {
  manifest: PluginManifest;
  /** The Plugin-relative module key of the entry, e.g. `index.js`. */
  entry: string;
  /** Every built module, keyed by its path under `dist/<id>/`. */
  sources: Readonly<Record<string, string>>;
}

/** `ReferenceError` text, e.g. `Intl is not defined`; captures the name. */
const NOT_DEFINED = /^(\S+) is not defined$/;

/** Runs the entry once, with or without the init event, and settles it. */
async function settleRun(input: AndroidCheckInput, withInit: boolean): Promise<SettledRun> {
  const { runQuickJsPlugin } = await import("@/features/plugins/quickjs");
  // The init event hands the Plugin one port. The check never answers it, so a
  // bare channel is enough; the test kit's broker would pull React into the CLI.
  const channel = withInit ? new MessageChannel() : null;
  const endpoint = { postMessage: () => {}, addEventListener: () => {} };
  const run = runQuickJsPlugin({
    sources: input.sources,
    entry: input.entry,
    endpoint,
    initEvent:
      channel === null
        ? undefined
        : {
            data: { kind: PLUGIN_INIT_MESSAGE.kind, startReason: "enable" },
            ports: [channel.port1],
          },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<SettledRun>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "timeout" }), RUN_TIMEOUT_MS);
  });
  try {
    return await Promise.race([run.outcome, timedOut]);
  } finally {
    clearTimeout(timer);
    run.dispose();
    channel?.port1.close();
    channel?.port2.close();
  }
}

/** The one readable line for a run that did not end `ready`, or null when it did. */
function describeFailure(
  outcome: SettledRun,
  phase: "evaluate" | "setup",
  entry: string,
  memoryCapBytes: number
): string | null {
  if (outcome.kind === "ready") return null;
  if (outcome.kind === "memory-death") {
    return `${entry} runs out of memory on Android during ${phase}: the QuickJS heap cap is ${memoryCapBytes} bytes; allocate less while the Plugin loads`;
  }
  if (outcome.kind === "timeout") {
    return `${entry} did not finish ${phase} on Android within ${RUN_TIMEOUT_MS / 1000}s; nothing the Plugin awaits at load may never settle`;
  }
  const missing = NOT_DEFINED.exec(outcome.message.trim());
  if (missing) {
    const name = missing[1];
    return `uses \`${name}\`, which Android Plugins lack: bundle a polyfill for it or drop the call. Android provides only ${ANDROID_GLOBALS.join(", ")}`;
  }
  if (phase === "evaluate") {
    return `${entry} does not evaluate on Android: ${outcome.message}. Fix the syntax or the top-level code it names`;
  }
  return `the Plugin's setup throws on Android: ${outcome.message}`;
}

/**
 * Runs the built entry through the Android engine. Passes when the module
 * evaluates and the init event sets the Plugin up; otherwise names the problem.
 */
export async function checkAndroidEntry(input: AndroidCheckInput): Promise<AndroidCheckResult> {
  const { entry } = input;
  const { QUICKJS_HEAP_CAP_BYTES } = await import("@/features/plugins/quickjs");
  const evaluated = await settleRun(input, false);
  const evaluateProblem = describeFailure(evaluated, "evaluate", entry, QUICKJS_HEAP_CAP_BYTES);
  if (evaluateProblem !== null) return { ok: false, details: [evaluateProblem] };
  const setUp = await settleRun(input, true);
  const setupProblem = describeFailure(setUp, "setup", entry, QUICKJS_HEAP_CAP_BYTES);
  if (setupProblem !== null) return { ok: false, details: [setupProblem] };
  return { ok: true, details: [`${entry} evaluates and sets up on the Android engine`] };
}
