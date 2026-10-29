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

/**
 * The QuickJS engine's own timings (#516, decision-401). Measured on the host
 * only when the Android QuickJS engine is enabled (`QUICKJS_ENGINE_ENABLED`):
 * the lane records them with **no gate** on them, so they are evidence, never a
 * pass/fail rule. `startMs` runs from starting the fixture Plugin to its ready;
 * `callLatencyMs` is the round-trip of one fixture Command that makes one Plugin
 * Permission call.
 */
export interface QuickJsTimings {
  /** Milliseconds from starting the fixture Plugin to its ready. */
  startMs: number;
  /** Milliseconds for one fixture Command's Plugin Permission call round-trip. */
  callLatencyMs: number;
}

/** The `/result` payload: the engine and every check, in run order. */
export interface ConformanceResult {
  engine: ConformanceEngine;
  checks: ConformanceCheck[];
  /**
   * The QuickJS timings (#516), present only when the run was measured under the
   * Android QuickJS engine; there is no gate on them (decision-401).
   */
  quickjs?: QuickJsTimings;
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

/**
 * What one escape Command produced. Whether the collector logged a request
 * originating in the Plugin is measured per check by the runner (D4), not here:
 * the collector's count is cumulative, so the seam reports only the outcome and
 * `leaks()` is read around each check.
 */
export interface CommandObservation {
  outcome: CommandOutcome;
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
 * What the File Grant probe observed (#653): the seeded file's `files.stat`,
 * the hex bytes two `files.read` ranges returned, and whether `files.release`
 * left the grant listed. Every field is a fact; `checks.ts` compares them with
 * the seeded file's own bytes.
 */
export interface FileGrantObservation {
  stat: { name: string; size: number; modified: number };
  /** The mid-file range's bytes, as lowercase hex. */
  range: string;
  /** The past-EOF read's bytes, as lowercase hex: shorter than asked, never padded. */
  tail: string;
  /** Whether the grant was still listed after `files.release`. */
  liveAfterRelease: boolean;
}

/**
 * T8's allocation cap (MB). A Worker that reaches it unstopped, with the host
 * still answering, has shown the engine sets no per-Worker memory limit below
 * the cap; the lane stops there rather than take the test machine to its limit.
 */
export const T8_ALLOCATION_CAP_MB = 4_096;

/**
 * What T8's yielding allocation observed (D4): whether the Plugin stopped at
 * all, the stop reason when it did, and the MB the fixture reported allocating
 * before it died. `stopped: false` is the honest "no stop within the budget"
 * outcome — the Worker neither reached its memory limit nor was stopped.
 */
export interface OomObservation {
  stopped: boolean;
  /** The lifecycle's stop reason, or `"none"` when it never stopped. */
  reason: string;
  /** The MB the fixture reported allocating before the stop (0 when none). */
  allocatedMb: number;
  /**
   * Whether a second, well-behaved Plugin running beside the hostile one still
   * answered a call after the hostile stop (#516). Present only when the hostile
   * Plugin stopped: `true` is the proof the renderer and the broker survived the
   * memory death with a neighbour live; `false` is a failure; `undefined` means
   * the seam did not observe a neighbour (there was no stop to survive).
   */
  neighbourAlive?: boolean;
}

/**
 * The runtime boundary the check runner is written against. The unit tests fake
 * this whole interface; `seam.ts` implements it over the real runtime, sandbox,
 * broker, and lifecycle.
 */
export interface ConformanceSeam {
  platform: ConformancePlatform;
  engine: ConformanceEngine;
  /**
   * The QuickJS timings (#516), present only when the seam measured them under
   * the Android QuickJS engine; `undefined` on every other engine.
   */
  quickjs?: QuickJsTimings;
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
  /**
   * The File Grant rows (#653) over a seeded memory store: what `files.read`
   * returned for a mid-file range and for a past-EOF read, what `files.stat`
   * reported, and whether `files.release` ended the grant.
   */
  probeFileGrants(): Promise<FileGrantObservation>;
  /** A host heartbeat posted after T8; false when the renderer no longer answers. */
  heartbeat(): Promise<boolean>;
  /**
   * The collector's cumulative count of requests the Plugin made. The runner
   * reads it before and after each escape check and fails on the delta, so one
   * leak cannot fail every later check (D4).
   */
  leaks(): Promise<number>;
  /** Releases the lifecycle and every listener the seam owns. */
  dispose?(): void;
}
