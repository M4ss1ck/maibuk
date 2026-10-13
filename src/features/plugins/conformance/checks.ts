/**
 * The check runner (#447, D4). It maps what a `ConformanceSeam` observes to the
 * `{id, status, detail}` checks the collector records, and it is the only place
 * the pass/fail rules live — the seam reports facts, this module decides.
 *
 * Rules (D4):
 *   - T2 passes when no Tauri IPC reached the Rust side. A sandboxed-frame probe
 *     is run on desktop and web; on Android the frame path is not probed or
 *     recorded at all (option F3, under private disclosure), so its check is
 *     omitted rather than failed.
 *   - Each fixture Command passes on its declared safe outcome (see
 *     `commands.ts`) and only when the collector logged no request from the
 *     Plugin.
 *   - T7 passes only when the busy loop was stopped as `unresponsive`.
 *   - The tight-loop allocation (`escape-allocate`) passes whenever the Plugin
 *     stopped with any reason and the host answered; it is the exhaustiveness
 *     test's owner for the old `escapeAllocate` Command.
 *   - T8 passes when the yielding allocation was stopped with a memory reason
 *     (`out-of-memory` or `crashed`) and the host answered a heartbeat
 *     afterwards. A stop as `unresponsive` means the collection loop never
 *     reached the memory limit, so the check is `unmeasured`, not a pass or a
 *     fail. Reaching `T8_ALLOCATION_CAP_MB` unstopped with the host answering
 *     passes: the engine set no per-Worker limit below the cap and the host
 *     survived. The time budget running out below the cap is `unmeasured`,
 *     naming the MB allocated. A missing heartbeat is `renderer-died` whatever the stop
 *     reason.
 *   - A check whose setup throws (the runtime never produced an observation) is
 *     `unmeasured`, never a fail: the run could not tell.
 */

import {
  CONFORMANCE_ESCAPES,
  type ConformanceEscape,
  escapeCheckId,
} from "@/features/plugins/conformance/commands";
import {
  type CommandObservation,
  type ConformanceCheck,
  type ConformanceSeam,
  T8_ALLOCATION_CAP_MB,
} from "@/features/plugins/conformance/types";

export { T8_ALLOCATION_CAP_MB };

export const T2_FRAME_CHECK_ID = "T2-frame-ipc";
export const T2_WORKER_CHECK_ID = "T2-worker-ipc";
export const T7_CHECK_ID = "T7-hang";
export const T8_CHECK_ID = "T8-oom";
/** The tight-loop allocation Command's own check (D1's `escape-<name>` shape). */
export const ESCAPE_ALLOCATE_CHECK_ID = "escape-allocate";

/** T7's only acceptable stop: the heartbeat missed until the Plugin was closed. */
export const T7_STOP_REASON = "unresponsive";

/** The stop reasons T8 accepts as a real memory death. */
export const T8_MEMORY_STOP_REASONS: readonly string[] = ["out-of-memory", "crashed"];

/** The stop reason that means the heartbeat policy fired before memory ran out. */
export const T8_UNRESPONSIVE_STOP_REASON = "unresponsive";

/** T8's detail when the yielding allocation was stopped as unresponsive first. */
export const T8_UNRESPONSIVE_DETAIL = "stopped as unresponsive before reaching the memory limit";

/** T8's detail when the renderer did not survive the allocation. */
export const RENDERER_DIED_DETAIL = "renderer-died";

/**
 * The terminal fixture Commands, each its own probe rather than a `command.run`
 * check. Listed here so `fixtureCommandCheckIds()` covers the whole manifest.
 */
const TERMINAL_COMMANDS: readonly { command: string; checkId: string }[] = [
  { command: "escapeBusyLoop", checkId: T7_CHECK_ID },
  { command: "escapeAllocateYielding", checkId: T8_CHECK_ID },
  { command: "escapeAllocate", checkId: ESCAPE_ALLOCATE_CHECK_ID },
];

/**
 * Every fixture-hostile Command id to the check id that covers it. The
 * exhaustiveness test compares this to the manifest's Command list, so a new
 * fixture Command fails until it has a check.
 */
export function fixtureCommandCheckIds(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const escapeCommand of CONFORMANCE_ESCAPES) {
    map[escapeCommand.command] = escapeCheckId(escapeCommand);
  }
  for (const terminal of TERMINAL_COMMANDS) map[terminal.command] = terminal.checkId;
  return map;
}

function pass(id: string, detail: string): ConformanceCheck {
  return { id, status: "pass", detail };
}

function fail(id: string, detail: string): ConformanceCheck {
  return { id, status: "fail", detail };
}

/** A check the run could not decide: not a pass and not a fail (D1). */
function unmeasured(id: string, detail: string): ConformanceCheck {
  return { id, status: "unmeasured", detail };
}

/**
 * Runs one check, turning a thrown setup into `unmeasured`. The runtime seam
 * throws when it cannot even produce an observation (the fixture did not start,
 * the frame could not be built); that is not the attempt failing.
 */
async function measure(
  id: string,
  work: () => Promise<ConformanceCheck>
): Promise<ConformanceCheck> {
  try {
    return await work();
  } catch (error) {
    return {
      id,
      status: "unmeasured",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

function describeOutcome(observation: CommandObservation): string {
  const { outcome } = observation;
  switch (outcome.kind) {
    case "refused":
    case "ignored":
    case "mounted":
    case "escaped":
      return outcome.detail;
    case "stopped":
      return `stopped with ${outcome.reason}`;
  }
}

/** The safe outcome the Command's check requires. */
function commandPasses(observation: CommandObservation, escapeCommand: ConformanceEscape): boolean {
  const { outcome } = observation;
  switch (escapeCommand.safe) {
    case "refused":
      return outcome.kind === "refused" || outcome.kind === "stopped";
    case "ignored":
      return outcome.kind === "ignored";
    case "mounted":
      return outcome.kind === "mounted";
    case "remote-ui-limit":
      return outcome.kind === "stopped" && outcome.reason === "remote-ui-limit";
  }
}

function escapeCheck(
  id: string,
  escapeCommand: ConformanceEscape,
  observation: CommandObservation
): ConformanceCheck {
  if (observation.leaked) {
    return fail(
      id,
      `${describeOutcome(observation)}; the collector logged a request from the Plugin`
    );
  }
  return commandPasses(observation, escapeCommand)
    ? pass(id, describeOutcome(observation))
    : fail(id, describeOutcome(observation) || "no safe outcome was observed");
}

/**
 * Runs every check, in schema order (T2 frame, T2 worker, the fixture Commands,
 * T7, the tight allocation, T8), and hands each result to `onCheck` as soon as
 * it is known, so the route can POST `/progress` before the run ends.
 */
export async function runConformanceChecks(
  seam: ConformanceSeam,
  onCheck?: (check: ConformanceCheck) => void | Promise<void>
): Promise<ConformanceCheck[]> {
  const checks: ConformanceCheck[] = [];
  const record = async (check: ConformanceCheck): Promise<void> => {
    checks.push(check);
    await onCheck?.(check);
  };

  // The Android frame path is off in v1 and under private disclosure: skip it
  // entirely so no sandboxed-frame IPC result is ever probed or recorded.
  if (seam.platform !== "android") {
    await record(
      await measure(T2_FRAME_CHECK_ID, async () => {
        const observation = await seam.probeFrameIpc();
        return observation.reached
          ? fail(T2_FRAME_CHECK_ID, `the sandboxed frame reached Tauri IPC: ${observation.detail}`)
          : pass(
              T2_FRAME_CHECK_ID,
              observation.detail || "the sandboxed frame reached no Tauri IPC"
            );
      })
    );
  }

  await record(
    await measure(T2_WORKER_CHECK_ID, async () => {
      const observation = await seam.probeWorkerIpc();
      return observation.reached
        ? fail(T2_WORKER_CHECK_ID, `the Worker reached Tauri IPC: ${observation.detail}`)
        : pass(T2_WORKER_CHECK_ID, observation.detail || "the Worker reached no Tauri IPC");
    })
  );

  for (const escapeCommand of CONFORMANCE_ESCAPES) {
    const id = escapeCheckId(escapeCommand);
    await record(
      await measure(id, async () =>
        escapeCheck(id, escapeCommand, await seam.runCommand(escapeCommand.command))
      )
    );
  }

  await record(
    await measure(T7_CHECK_ID, async () => {
      const { reason } = await seam.probeHang();
      return reason === T7_STOP_REASON
        ? pass(T7_CHECK_ID, `stopped with ${reason}`)
        : fail(T7_CHECK_ID, `stopped with ${reason}, expected ${T7_STOP_REASON}`);
    })
  );

  await record(
    await measure(ESCAPE_ALLOCATE_CHECK_ID, async () => {
      const { reason } = await seam.probeAllocate();
      const alive = await seam.heartbeat();
      if (!alive) return fail(ESCAPE_ALLOCATE_CHECK_ID, RENDERER_DIED_DETAIL);
      return pass(ESCAPE_ALLOCATE_CHECK_ID, `stopped with ${reason} and the host answered`);
    })
  );

  await record(
    await measure(T8_CHECK_ID, async () => {
      const oom = await seam.probeOom();
      const alive = await seam.heartbeat();
      if (!alive) return fail(T8_CHECK_ID, RENDERER_DIED_DETAIL);
      if (!oom.stopped) {
        return oom.allocatedMb >= T8_ALLOCATION_CAP_MB
          ? pass(
              T8_CHECK_ID,
              `no engine memory limit by ${oom.allocatedMb} MB; the Worker kept running and the host answered`
            )
          : unmeasured(T8_CHECK_ID, `no stop within the budget; allocated ${oom.allocatedMb} MB`);
      }
      const facts = `reason ${oom.reason}, allocated ${oom.allocatedMb} MB`;
      if (oom.reason === T8_UNRESPONSIVE_STOP_REASON) {
        return unmeasured(T8_CHECK_ID, `${T8_UNRESPONSIVE_DETAIL} (${facts})`);
      }
      return T8_MEMORY_STOP_REASONS.includes(oom.reason)
        ? pass(
            T8_CHECK_ID,
            `stopped with ${oom.reason} after ${oom.allocatedMb} MB and the host answered`
          )
        : fail(T8_CHECK_ID, `stopped with an unexpected reason; ${facts} and the host answered`);
    })
  );

  return checks;
}
