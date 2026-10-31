// The Frame platform gate (#454, D6): Custom Frame UI is off on Android (#517), on
// Windows until a manual WebView2 Frame conformance run is recorded (and every
// Frame check in it passed), and on everywhere else. The rule is pure, so it is
// proven over each platform string and an injected record, without the build env
// or module mocking.

import { describe, expect, it } from "vitest";
import { pluginFrameAvailableOn } from "@/features/plugins/host-platform";
import type {
  WindowsFrameCheck,
  WindowsFrameRecord,
} from "@/features/plugins/windows-frame-record";

/** A committed Windows record with every Frame check passing. */
function windowsRecord(overrides: Partial<WindowsFrameRecord> = {}): WindowsFrameRecord {
  const checks: WindowsFrameCheck[] = [
    { id: "frame-no-network", status: "pass", detail: "no request from the Frame" },
    { id: "frame-no-tauri-ipc", status: "pass", detail: "no __TAURI_INTERNALS__ in the Frame" },
    {
      id: "frame-no-host-dom",
      status: "pass",
      detail: "cross-origin access to the host DOM throws",
    },
    { id: "frame-theme-tokens", status: "pass", detail: "a theme switch updated --maibuk-*" },
    { id: "frame-notice-visible", status: "pass", detail: "the custom-UI notice is visible" },
    { id: "frame-keyboard", status: "pass", detail: "Tab reached the Frame" },
  ];
  return {
    ranAt: "2026-10-15T00:00:00.000Z",
    engine: { name: "tauri-webview2", version: "1.2.3.4", userAgent: "Mozilla/5.0" },
    appVersion: "0.11.0",
    commit: "abc1234",
    ranBy: "Andy",
    exit: 0,
    ...overrides,
    checks: overrides.checks ?? checks,
  };
}

describe("pluginFrameAvailableOn()", () => {
  it("is available on desktop Linux, macOS, and the web (null), with or without a record", () => {
    expect(pluginFrameAvailableOn("linux")).toBe(true);
    expect(pluginFrameAvailableOn("macos")).toBe(true);
    expect(pluginFrameAvailableOn(null)).toBe(true);
    expect(pluginFrameAvailableOn("linux", windowsRecord())).toBe(true);
  });

  it("is unavailable on Android, whatever the record says", () => {
    expect(pluginFrameAvailableOn("android")).toBe(false);
    expect(pluginFrameAvailableOn("android", windowsRecord())).toBe(false);
  });

  it("is unavailable on Windows with no committed record (not run yet)", () => {
    expect(pluginFrameAvailableOn("windows", null)).toBe(false);
    expect(pluginFrameAvailableOn("windows", undefined)).toBe(false);
  });

  it("is available on Windows when the record has every Frame check passing", () => {
    expect(pluginFrameAvailableOn("windows", windowsRecord())).toBe(true);
  });

  it("is unavailable on Windows when a Frame check failed", () => {
    const failed = windowsRecord({
      checks: [
        { id: "frame-no-network", status: "pass", detail: "no request from the Frame" },
        { id: "frame-no-tauri-ipc", status: "fail", detail: "__TAURI_INTERNALS__ answered" },
      ],
    });
    expect(pluginFrameAvailableOn("windows", failed)).toBe(false);
  });

  it("is unavailable on Windows when a Frame check was not measured", () => {
    const unmeasured = windowsRecord({
      checks: [{ id: "frame-no-network", status: "unmeasured", detail: "the Frame never mounted" }],
    });
    expect(pluginFrameAvailableOn("windows", unmeasured)).toBe(false);
  });

  it("is unavailable on Windows when the record lists no checks", () => {
    expect(pluginFrameAvailableOn("windows", windowsRecord({ checks: [] }))).toBe(false);
  });
});

// The Windows desktop shell is read from the shared platform leaf (#454 D6), so
// the gate no longer re-derives `TAURI_ENV_PLATFORM` on its own.
describe("the shared Windows platform seam", () => {
  it("exposes IS_WINDOWS from the platform leaf and re-exports it", async () => {
    const windows = await import("@/lib/platform/windows");
    const platform = await import("@/lib/platform");
    expect(typeof windows.IS_WINDOWS).toBe("boolean");
    expect(platform.IS_WINDOWS).toBe(windows.IS_WINDOWS);
  });
});
