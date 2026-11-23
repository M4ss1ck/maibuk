import { describe, expect, it } from "vitest";

import type { ConformanceLaunchReport } from "@/features/plugins/conformance/types";
import {
  BACKGROUND_DEATH_CHECK_ID,
  backgroundDeathCheck,
} from "@/test/support/plugin-conformance/death";

// The Android death phase's background-death rule (#922). Pure, so every branch
// is tested without a device, an adb, or a WebView: the app is launched,
// backgrounded, its renderer killed, and relaunched by the process shell.

function report(
  plugins: { id: string; enabled: boolean }[],
  notices: string[] = []
): ConformanceLaunchReport {
  return { plugins, notices };
}

const before = report([
  { id: "example.alpha", enabled: true },
  { id: "example.beta", enabled: true },
]);

describe("BACKGROUND_DEATH_CHECK_ID", () => {
  it("is death-background", () => {
    expect(BACKGROUND_DEATH_CHECK_ID).toBe("death-background");
  });
});

describe("backgroundDeathCheck", () => {
  it("fails when the app posted no launch report before the kill", () => {
    expect(backgroundDeathCheck({ before: null, processExited: true, after: before })).toEqual({
      id: "death-background",
      status: "fail",
      detail: "the app posted no launch report before the renderer was killed",
    });
  });

  it("fails when the app process did not exit", () => {
    expect(backgroundDeathCheck({ before, processExited: false, after: before })).toEqual({
      id: "death-background",
      status: "fail",
      detail: "the app process did not exit after its renderer died in the background",
    });
  });

  it("fails when the app posted no launch report after the relaunch", () => {
    expect(backgroundDeathCheck({ before, processExited: true, after: null })).toEqual({
      id: "death-background",
      status: "fail",
      detail: "the app did not come back, or posted no launch report, after the relaunch",
    });
  });

  it("fails naming the Plugins missing or disabled after the death", () => {
    const after = report([
      { id: "example.alpha", enabled: false },
      { id: "example.gamma", enabled: true },
    ]);
    expect(backgroundDeathCheck({ before, processExited: true, after })).toEqual({
      id: "death-background",
      status: "fail",
      detail: "the relaunched app lost enabled Plugins: example.alpha, example.beta",
    });
  });

  it("fails naming the notices after the relaunch", () => {
    const after = report(before.plugins, ["Plugin failed to start", "Worker crashed"]);
    expect(backgroundDeathCheck({ before, processExited: true, after })).toEqual({
      id: "death-background",
      status: "fail",
      detail: "the relaunched app posted notices: Plugin failed to start, Worker crashed",
    });
  });

  it("passes on a cold start with every Plugin still enabled and no notice", () => {
    expect(backgroundDeathCheck({ before, processExited: true, after: before })).toEqual({
      id: "death-background",
      status: "pass",
      detail: "cold start with 2 Plugins still enabled and no notice",
    });
  });
});
