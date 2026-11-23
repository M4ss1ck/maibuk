import { describe, expect, it } from "vitest";

import { FIXTURE_HEALTHY_ID, FIXTURE_HOSTILE_ID } from "@/features/plugins/conformance/fixture";
import type { ConformanceLaunchReport } from "@/features/plugins/conformance/types";
import {
  BACKGROUND_DEATH_CHECK_ID,
  backgroundDeathCheck,
  foregroundDeathCheck,
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

// The Android foreground death rule (#928): T8 kills the renderer in the
// foreground and the app restarts itself; the rule compares the launch report
// before T8 with the one after the rebirth.
const fixtureBefore = report([
  { id: FIXTURE_HOSTILE_ID, enabled: true },
  { id: FIXTURE_HEALTHY_ID, enabled: true },
]);
const survived = report(
  [
    { id: FIXTURE_HOSTILE_ID, enabled: false },
    { id: FIXTURE_HEALTHY_ID, enabled: true },
  ],
  ["Plugin fixture-hostile was disabled after it crashed"]
);

describe("foregroundDeathCheck", () => {
  it("fails when the app posted no launch report before T8", () => {
    expect(foregroundDeathCheck({ before: null, after: survived })).toEqual({
      id: "T8-oom",
      status: "fail",
      detail: "the app posted no launch report before T8",
    });
  });

  it("fails when the app did not come back after the death", () => {
    expect(foregroundDeathCheck({ before: fixtureBefore, after: null })).toEqual({
      id: "T8-oom",
      status: "fail",
      detail: "the app did not come back after its renderer died during T8",
    });
  });

  it("fails when the hostile Plugin is still enabled after the death", () => {
    const after = report(
      [
        { id: FIXTURE_HOSTILE_ID, enabled: true },
        { id: FIXTURE_HEALTHY_ID, enabled: true },
      ],
      ["Plugin crashed"]
    );
    expect(foregroundDeathCheck({ before: fixtureBefore, after })).toEqual({
      id: "T8-oom",
      status: "fail",
      detail: "the hostile Plugin is still enabled after the death",
    });
  });

  it("fails when the idle healthy Plugin was disabled", () => {
    const after = report(
      [
        { id: FIXTURE_HOSTILE_ID, enabled: false },
        { id: FIXTURE_HEALTHY_ID, enabled: false },
      ],
      ["Plugin crashed"]
    );
    expect(foregroundDeathCheck({ before: fixtureBefore, after })).toEqual({
      id: "T8-oom",
      status: "fail",
      detail: "the idle healthy Plugin was disabled",
    });
  });

  it("fails when no notice was shown after the death", () => {
    const after = report([
      { id: FIXTURE_HOSTILE_ID, enabled: false },
      { id: FIXTURE_HEALTHY_ID, enabled: true },
    ]);
    expect(foregroundDeathCheck({ before: fixtureBefore, after })).toEqual({
      id: "T8-oom",
      status: "fail",
      detail: "no notice was shown after the death",
    });
  });

  it("passes when the hostile Plugin is disabled, the healthy one enabled, and a notice shown", () => {
    expect(foregroundDeathCheck({ before: fixtureBefore, after: survived })).toEqual({
      id: "T8-oom",
      status: "pass",
      detail:
        "the renderer died in the foreground; fixture-hostile disabled, fixture-healthy still enabled, notice: Plugin fixture-hostile was disabled after it crashed",
    });
  });
});
