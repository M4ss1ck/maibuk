/**
 * The result shape of the test-only Plugin conformance route (#447, Unit 2).
 *
 * This module is the seam the check runner talks to, never a WebView, a Worker,
 * or the Plugin runtime itself: `checks.ts` maps observations to check statuses
 * and `seam.ts` is the one place that drives the real runtime. The route only
 * exists inside a build that sets `VITE_PLUGIN_CONFORMANCE=1` (D3), so nothing
 * here reaches a shipped bundle.
 *
 * Every check id and the result schema come from the supervisor's decisions
 * (`docs/plans/447-plan.md`, D1). The runner writes them to the collector; the
 * `conformance:plugins` lane owns the results file.
 */

/** Where the route runs. Only `android` changes the probes it may run (D4). */
export type ConformancePlatform = "desktop" | "android" | "web";

/** A check's verdict. `unmeasured` means its setup could not run at all. */
export type ConformanceCheckStatus = "pass" | "fail" | "unmeasured";

/** One check, as the schema records it (`D1`). */
export interface ConformanceCheck {
  id: string;
  status: ConformanceCheckStatus;
  detail: string;
}

/** The WebView the checks ran in, as `D1` records it. */
export interface ConformanceEngine {
  name: string;
  version: string;
  userAgent: string;
}

/** The `/result` payload: the engine and every check, in run order. */
export interface ConformanceResult {
  engine: ConformanceEngine;
  checks: ConformanceCheck[];
}

/**
 * What one fixture Command produced.
 *
 * `refused` is the Plugin's typed refusal, `stopped` is the host stopping it
 * with a reason (a lifecycle reason, e.g. `remote-ui-limit`), `ignored` is a
 * forged reply the broker ignored while the Plugin stayed healthy
 * (`escapeSpoofedReply`), `mounted` is a page that mounted and left the Plugin
 * ready (`openPanel`), and `escaped` is the attempt succeeding — the only one a
 * check fails on its own.
 */
export type CommandOutcome =
  | { kind: "refused"; detail: string }
  | { kind: "stopped"; reason: string; detail: string }
  | { kind: "ignored"; detail: string }
  | { kind: "mounted"; detail: string }
  | { kind: "escaped"; detail: string };

/** An escape's outcome plus whether the collector saw a request the Plugin made. */
export interface CommandObservation {
  outcome: CommandOutcome;
  /** True when the collector logged a request originating in the Plugin. */
  leaked: boolean;
}

/** A T2 IPC probe's result: `reached` means Tauri IPC answered from the sandbox. */
export interface IpcObservation {
  reached: boolean;
  detail: string;
}

/** The stop a terminal probe that always ends in a stop (T7, and the tight allocation) observed. */
export interface StopObservation {
  reason: string;
}

/**
 * What T8's yielding allocation observed (D4): whether the Plugin stopped at
 * all, the stop reason when it did, and the MB the fixture reported allocating
 * before it died. `stopped: false` is the honest "no stop within the budget"
 * outcome — the Worker neither reached its memory limit nor was stopped.
 */
/**
 * T8's allocation cap (MB). A Worker that reaches it unstopped, with the host
 * still answering, has shown the engine sets no per-Worker memory limit below
 * the cap; the lane stops there rather than take the test machine to its limit.
 */
export const T8_ALLOCATION_CAP_MB = 4_096;

export interface OomObservation {
  stopped: boolean;
  /** The lifecycle's stop reason, or `"none"` when it never stopped. */
  reason: string;
  /** The MB the fixture reported allocating before the stop (0 when none). */
  allocatedMb: number;
}

/**
 * The runtime boundary the check runner is written against. The unit tests fake
 * this whole interface; `seam.ts` implements it over the real runtime, sandbox,
 * broker, and lifecycle.
 */
export interface ConformanceSeam {
  platform: ConformancePlatform;
  engine: ConformanceEngine;
  /** Runs one fixture-hostile escape Command and reports what was observed. */
  runCommand(command: string): Promise<CommandObservation>;
  /** T2 from a sandboxed frame (desktop only; never called on Android). */
  probeFrameIpc(): Promise<IpcObservation>;
  /** T2 from the Plugin's Worker. */
  probeWorkerIpc(): Promise<IpcObservation>;
  /** T7: the busy loop, resolved once the host stopped the Plugin. */
  probeHang(): Promise<StopObservation>;
  /** The tight-loop allocation: resolved once the host stopped the Plugin (any reason passes). */
  probeAllocate(): Promise<StopObservation>;
  /** T8: the yielding allocation, resolved once the Plugin stopped or the budget ran out. */
  probeOom(): Promise<OomObservation>;
  /** A host heartbeat posted after T8; false when the renderer no longer answers. */
  heartbeat(): Promise<boolean>;
  /** Releases the lifecycle and every listener the seam owns. */
  dispose?(): void;
}
