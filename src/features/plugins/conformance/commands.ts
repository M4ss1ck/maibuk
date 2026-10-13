/**
 * The fixture-hostile Commands the conformance route runs (#447, D4).
 *
 * The fixture (`e2e/fixtures/plugin-sources/fixture-hostile/index.tsx`) exposes
 * one Command per attempt. Every Command it declares is mapped here to exactly
 * one check, and `checks.ts` derives the check ids; a unit test enumerates the
 * manifest's Commands and fails if one has no check, so a new fixture Command
 * cannot be forgotten.
 *
 * The check id shape is `D1`'s `escape-<name>`, the only non-terminal id the
 * schema defines; the three UI Commands (`openPanel`, `uiViolation`, `uiFlood`)
 * use it too because the schema has no other shape, and each carries the safe
 * outcome it must show:
 *   - `openPanel` mounts the readiness page and must leave the Plugin ready;
 *   - `uiViolation` / `uiFlood` mount a page the host validator refuses, so the
 *     lifecycle stops the Plugin with `remote-ui-limit`;
 *   - `escapeSpoofedReply` must have its forged reply ignored while the Plugin
 *     stays healthy (the E2E's rule);
 *   - the rest report a typed refusal, or are stopped with a reason.
 *
 * `escapeBusyLoop`, `escapeAllocateYielding`, and `escapeAllocate` are terminal:
 * `checks.ts` maps them to `T7-hang`, `T8-oom`, and `escape-allocate`, which run
 * as their own probes, not through `runCommand`.
 */

/** The safe outcome a fixture Command must show for its check to pass. */
export type CommandSafeOutcome = "refused" | "ignored" | "remote-ui-limit" | "mounted";

/** One fixture Command and the safe outcome its check requires. */
export interface ConformanceEscape {
  /** The Command-local id the fixture's `command.run` handler expects. */
  command: string;
  /** The schema's `<name>` in `escape-<name>`. */
  name: string;
  /** The outcome the check passes on. */
  safe: CommandSafeOutcome;
}

/**
 * Every non-terminal fixture-hostile Command, in the order the manifest lists
 * them. The terminal ones (`escapeBusyLoop`, `escapeAllocateYielding`,
 * `escapeAllocate`) live in `checks.ts` beside their probes.
 */
export const CONFORMANCE_ESCAPES: readonly ConformanceEscape[] = [
  { command: "openPanel", name: "openPanel", safe: "mounted" },
  { command: "uiViolation", name: "uiViolation", safe: "remote-ui-limit" },
  { command: "uiFlood", name: "uiFlood", safe: "remote-ui-limit" },
  { command: "escapeFetch", name: "fetch", safe: "refused" },
  { command: "escapeXhr", name: "xhr", safe: "refused" },
  { command: "escapeWebSocket", name: "webSocket", safe: "refused" },
  { command: "escapeEventSource", name: "eventSource", safe: "refused" },
  { command: "escapeSendBeacon", name: "sendBeacon", safe: "refused" },
  { command: "escapeImportScripts", name: "importScripts", safe: "refused" },
  { command: "escapeDynamicImport", name: "dynamicImport", safe: "refused" },
  { command: "escapeEval", name: "eval", safe: "refused" },
  { command: "escapeDataWorker", name: "dataWorker", safe: "refused" },
  { command: "escapeIndexedDb", name: "indexedDb", safe: "refused" },
  { command: "escapeCaches", name: "caches", safe: "refused" },
  { command: "escapeLocalStorage", name: "localStorage", safe: "refused" },
  { command: "escapeTauriIpc", name: "tauriIpc", safe: "refused" },
  { command: "escapeOversized", name: "oversized", safe: "refused" },
  { command: "escapeUnknownMethod", name: "unknownMethod", safe: "refused" },
  { command: "escapeSpoofedReply", name: "spoofedReply", safe: "ignored" },
  { command: "escapeWrite", name: "write", safe: "refused" },
  { command: "escapeAfterRevoke", name: "afterRevoke", safe: "refused" },
  { command: "escapeFlood", name: "flood", safe: "refused" },
];

/** The check id one escape records (`D1`). */
export function escapeCheckId(escapeCommand: ConformanceEscape): string {
  return `escape-${escapeCommand.name}`;
}
