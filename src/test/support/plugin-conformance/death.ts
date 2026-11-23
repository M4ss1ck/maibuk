// The Android death phase's rules (#922, #928). Pure, so the checks are tested
// without a device, an adb, or a WebView: `e2e/conformance/run-plugins.ts` drives
// the app and hands the launch reports to these rules.
//
// Background death (#922): launch, take the launch report, background the app,
// kill its renderer, wait for the process to exit, relaunch, and hand both
// reports and the exit fact to `backgroundDeathCheck`.
//
// Foreground death (#928): under the native Worker T8 kills the Android renderer
// in the foreground, so the app restarts itself through ProcessPhoenix; the
// foreground phase waits out the blame window, launches with the collector
// saying `t8-only`, waits for the rebirth, and hands both reports to
// `foregroundDeathCheck`.

import {
  FIXTURE_HEALTHY_ID,
  FIXTURE_HOSTILE_ID,
  T8_CHECK_ID,
} from "@/features/plugins/conformance/checks";
import type {
  ConformanceCheck,
  ConformanceLaunchReport,
} from "@/features/plugins/conformance/types";

/** The death phase's check id: the app survives its renderer being killed. */
export const BACKGROUND_DEATH_CHECK_ID = "death-background";

/**
 * The one background-death rule, first match wins. A pass is a cold start that
 * kept every Plugin enabled before the kill enabled after it, with no notice.
 */
export function backgroundDeathCheck(input: {
  /** The launch report the app posted before the renderer was killed. */
  before: ConformanceLaunchReport | null;
  /** Whether the app process exited after its renderer died in the background. */
  processExited: boolean;
  /** The launch report the app posted after the relaunch. */
  after: ConformanceLaunchReport | null;
}): ConformanceCheck {
  const fail = (detail: string): ConformanceCheck => ({
    id: BACKGROUND_DEATH_CHECK_ID,
    status: "fail",
    detail,
  });
  if (input.before === null) {
    return fail("the app posted no launch report before the renderer was killed");
  }
  if (!input.processExited) {
    return fail("the app process did not exit after its renderer died in the background");
  }
  if (input.after === null) {
    return fail("the app did not come back, or posted no launch report, after the relaunch");
  }

  const afterEnabled = new Map(input.after.plugins.map((plugin) => [plugin.id, plugin.enabled]));
  const lost = input.before.plugins
    .filter((plugin) => plugin.enabled && afterEnabled.get(plugin.id) !== true)
    .map((plugin) => plugin.id);
  if (lost.length > 0) {
    return fail(`the relaunched app lost enabled Plugins: ${lost.join(", ")}`);
  }
  if (input.after.notices.length > 0) {
    return fail(`the relaunched app posted notices: ${input.after.notices.join(", ")}`);
  }

  const enabled = input.after.plugins.filter((plugin) => plugin.enabled).length;
  return {
    id: BACKGROUND_DEATH_CHECK_ID,
    status: "pass",
    detail: `cold start with ${enabled} ${enabled === 1 ? "Plugin" : "Plugins"} still enabled and no notice`,
  };
}

/**
 * The foreground-death rule (#928): after T8 killed the renderer, the app came
 * back on its own with the hostile Plugin disabled and the healthy one still
 * enabled, and showed a notice. First match wins.
 */
export function foregroundDeathCheck(input: {
  /** The launch report the app posted before T8. */
  before: ConformanceLaunchReport | null;
  /** The launch report the app posted after its renderer died during T8. */
  after: ConformanceLaunchReport | null;
}): ConformanceCheck {
  const fail = (detail: string): ConformanceCheck => ({
    id: T8_CHECK_ID,
    status: "fail",
    detail,
  });
  if (input.before === null) {
    return fail("the app posted no launch report before T8");
  }
  if (input.after === null) {
    return fail("the app did not come back after its renderer died during T8");
  }

  const afterEnabled = new Map(input.after.plugins.map((plugin) => [plugin.id, plugin.enabled]));
  if (afterEnabled.get(FIXTURE_HOSTILE_ID) === true) {
    return fail("the hostile Plugin is still enabled after the death");
  }
  if (afterEnabled.get(FIXTURE_HEALTHY_ID) !== true) {
    return fail("the idle healthy Plugin was disabled");
  }
  if (input.after.notices.length === 0) {
    return fail("no notice was shown after the death");
  }

  return {
    id: T8_CHECK_ID,
    status: "pass",
    detail: `the renderer died in the foreground; fixture-hostile disabled, fixture-healthy still enabled, notice: ${input.after.notices[0]}`,
  };
}
