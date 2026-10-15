/**
 * The Windows WebView2 Frame gate's committed record (#454 unit U5, D6).
 *
 * D6 keeps the custom-UI `Frame` off on Windows until a human runs the Frame
 * conformance on a real WebView2 and records it. The record lives in the lane's
 * own results file, `docs/research/plugins-conformance.results.json`: that is
 * the file `scripts/plugin-conformance-gate.mjs` already validates and the one
 * the conformance lane writes into, so it is the single home for engine records
 * (the `#407` engine-verification file has no platform slots and no gate). The
 * record is a `platforms.windows` slot whose absence means "not run", which
 * keeps the Frame off.
 *
 * The slot is read at BUILD TIME through a static JSON import (Vite inlines it,
 * so there is no runtime IO and the answer is a constant in the bundle). The
 * file is ~9 KB; the repo already ships a larger JSON this way
 * (`lucide-icon-names.json`, imported into the manifest validator), so a
 * generated boolean module would add a second artifact that can drift from the
 * committed record for no practical bundle win.
 *
 * The shape is committed by a human after the manual run; the gate script
 * rejects a malformed slot in CI, and the checklist is
 * `docs/research/plugins-frame-windows-conformance.md`.
 */

import results from "../../../docs/research/plugins-conformance.results.json";

/** One Frame check a Windows record carries, in the conformance `{id,status,detail}` shape. */
export interface WindowsFrameCheck {
  id: string;
  status: "pass" | "fail" | "unmeasured";
  detail: string;
}

/**
 * The WebView2 the run measured. `version` is the WebView2 *runtime* version,
 * never the app version (the #447 rule), and `name` is `"tauri-webview2"`,
 * mirroring Linux's `"tauri-webkitgtk"` and Android's `"android-webview"`.
 */
export interface WindowsFrameEngine {
  name: string;
  version: string;
  userAgent: string;
}

/**
 * The minimum a committed `platforms.windows` slot must carry (#454 unit U5):
 * when it ran, the WebView2 it ran in, the app version and commit the run was
 * built from, who ran it, the lane exit code, and the per-check results. The
 * gate reads `checks`; the rest is the audit trail the record exists for.
 */
export interface WindowsFrameRecord {
  ranAt: string;
  engine: WindowsFrameEngine;
  device?: string;
  appVersion: string;
  commit: string;
  ranBy: string;
  exit: 0 | 1;
  checks: WindowsFrameCheck[];
}

/**
 * The Frame checks a Windows record must cover; the checklist
 * (`docs/research/plugins-frame-windows-conformance.md`) is this list and
 * `scripts/plugin-conformance-gate.mjs` requires every id. The app's gate
 * requires every recorded check `pass`; the script requires them all present,
 * so a record that quietly drops a check cannot flip the gate.
 */
export const WINDOWS_FRAME_CHECK_IDS = [
  "frame-no-network",
  "frame-no-tauri-ipc",
  "frame-no-host-dom",
  "frame-theme-tokens",
  "frame-notice-visible",
  "frame-keyboard",
] as const;

/**
 * True when a committed Windows record clears the Frame gate (D6): it exists,
 * lists at least one check, and every check passed. A `fail` or `unmeasured`
 * check, or no record at all, keeps the Frame off.
 */
export function windowsFrameRecordPasses(
  record: WindowsFrameRecord | null | undefined
): boolean {
  if (record == null) return false;
  if (!Array.isArray(record.checks) || record.checks.length === 0) return false;
  return record.checks.every((check) => check.status === "pass");
}

/**
 * The committed record's `platforms.windows` slot, or null when it is absent
 * (never run). Cast at this one boundary: the file is JSON, and the gate script
 * is what rejects a malformed slot in CI.
 */
function readWindowsSlot(file: unknown): WindowsFrameRecord | null {
  const platforms = (file as { platforms?: Record<string, unknown> } | null)?.platforms;
  const slot = platforms?.windows;
  return slot == null ? null : (slot as WindowsFrameRecord);
}

/** The committed Windows record, or null when the manual run has not happened. */
export const WINDOWS_FRAME_RECORD: WindowsFrameRecord | null = readWindowsSlot(results);
