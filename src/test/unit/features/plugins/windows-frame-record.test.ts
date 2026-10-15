// The Windows WebView2 Frame gate's record rule (#454 D6): a committed record
// clears the gate only when it lists every required Frame check and each one
// passed. Missing a single id keeps the Frame off, so a record that quietly
// drops a check cannot flip the gate (the gate script requires the same ids).

import { describe, expect, it } from "vitest";
import {
  WINDOWS_FRAME_CHECK_IDS,
  windowsFrameRecordPasses,
  type WindowsFrameCheck,
  type WindowsFrameRecord,
} from "@/features/plugins/windows-frame-record";

function passingChecks(): WindowsFrameCheck[] {
  return WINDOWS_FRAME_CHECK_IDS.map((id) => ({ id, status: "pass", detail: "ok" }));
}

function record(checks: WindowsFrameCheck[]): WindowsFrameRecord {
  return {
    ranAt: "2026-10-15T00:00:00.000Z",
    engine: { name: "tauri-webview2", version: "1.2.3.4", userAgent: "Mozilla/5.0" },
    appVersion: "0.11.0",
    commit: "abc1234",
    ranBy: "Andy",
    exit: 0,
    checks,
  };
}

describe("windowsFrameRecordPasses()", () => {
  it("passes when every required check id passed", () => {
    expect(windowsFrameRecordPasses(record(passingChecks()))).toBe(true);
  });

  it("fails when one required check id is missing", () => {
    const [first, ...rest] = WINDOWS_FRAME_CHECK_IDS;
    const missing = passingChecks().filter((check) => check.id !== first);
    expect(missing).toHaveLength(WINDOWS_FRAME_CHECK_IDS.length - 1);
    expect(rest).not.toContain(first);
    expect(windowsFrameRecordPasses(record(missing))).toBe(false);
  });

  it("fails when a listed check did not pass", () => {
    const checks = passingChecks().map((check, index) =>
      index === 0 ? { ...check, status: "fail" as const } : check
    );
    expect(windowsFrameRecordPasses(record(checks))).toBe(false);
  });

  it("fails with no record and with no checks", () => {
    expect(windowsFrameRecordPasses(null)).toBe(false);
    expect(windowsFrameRecordPasses(undefined)).toBe(false);
    expect(windowsFrameRecordPasses(record([]))).toBe(false);
  });
});
