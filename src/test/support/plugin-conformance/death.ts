// The Android death phase's background-death rule (#922). Pure, so the check is
// tested without a device, an adb, or a WebView: `e2e/conformance/run-plugins.ts`
// launches the app, takes the launch report it posts, backgrounds it, kills its
// renderer, waits for the process to exit, relaunches, and hands both reports
// and the exit fact to `backgroundDeathCheck`.

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
