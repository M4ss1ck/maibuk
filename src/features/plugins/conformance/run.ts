/**
 * The conformance route's one entry point (#447, D3). It posts the launch
 * report, obeys the collector's launch plan (#928), builds the runtime seam
 * over the real Plugin lifecycle, runs the checks with each result POSTed to the
 * collector as it settles, then posts the whole result and `/done`, and disposes
 * the lifecycle.
 *
 * Only `ConformancePage` calls this, and the page is imported lazily only under
 * `VITE_PLUGIN_CONFORMANCE=1` (App.tsx), so a normal build never reaches here.
 */

import { currentToastMessages } from "@/components/ui/Toast";
import { listPluginApprovals } from "@/features/plugins/approvals";
import { PLUGIN_BLAME_WINDOW_MS } from "@/features/plugins/crash-containment";
import { getPluginLifecycle } from "@/features/plugins/lifecycle-instance";
import { runConformanceChecks } from "@/features/plugins/conformance/checks";
import { createReporter } from "@/features/plugins/conformance/reporter";
import { createRuntimeSeam, readEngine, readPlatform } from "@/features/plugins/conformance/seam";
import type { ConformanceResult } from "@/features/plugins/conformance/types";

/** How long the route waits for main.tsx to install the app's Plugin lifecycle. */
const LIFECYCLE_INSTALL_TIMEOUT_MS = 10_000;

/** How often the route checks whether the lifecycle is installed. */
const LIFECYCLE_POLL_MS = 50;

/**
 * How long past the blame window a `t8-only` launch waits, so a heartbeat
 * that lands on the window's edge cannot still blame the healthy fixture.
 */
const BLAME_WINDOW_MARGIN_MS = 2_000;

/**
 * Waits until main.tsx has installed the app's Plugin lifecycle, which applies
 * the Android death record synchronously as it launches (#927). main.tsx renders
 * first and loads Plugins on idle, so without this wait the launch report would
 * show the Plugins before containment disabled any (#928). Bounded: a lifecycle
 * that never installs leaves the report as it is.
 */
async function waitForPluginLifecycle(): Promise<void> {
  const deadline = Date.now() + LIFECYCLE_INSTALL_TIMEOUT_MS;
  while (getPluginLifecycle() === null && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, LIFECYCLE_POLL_MS));
  }
}

export async function runConformance(): Promise<ConformanceResult> {
  const reporter = createReporter();
  await waitForPluginLifecycle();
  // First, before the seam runs anything, so the report shows the state the app
  // launched with: the Plugins it knows and the notices it is showing (#922).
  // The collector answers with the plan this launch obeys (#928).
  const plan = await reporter.launch({
    plugins: listPluginApprovals().map((approval) => ({
      id: approval.pluginId,
      enabled: approval.enabled,
    })),
    notices: currentToastMessages(),
  });

  // The relaunch and background death phases post the launch report and
  // nothing else. The result still carries the engine `/result` would, derived
  // exactly as the seam does without starting it (#928).
  if (plan === "launch-only") {
    await reporter.done();
    return { engine: readEngine(readPlatform()), checks: [] };
  }

  const seam = await createRuntimeSeam({
    heartbeat: () => reporter.heartbeat(),
    leaks: () => reporter.leaks(),
  });
  try {
    // The Android foreground death launch runs T8 alone. Wait out the blame
    // window first so the healthy fixture is idle when the death record is
    // written, rather than blamed for the hostile Plugin's death (#928).
    if (plan === "t8-only") {
      await new Promise((resolve) =>
        setTimeout(resolve, PLUGIN_BLAME_WINDOW_MS + BLAME_WINDOW_MARGIN_MS)
      );
    }
    const checks = await runConformanceChecks(seam, (check) => reporter.progress(check), { plan });
    const result: ConformanceResult = {
      engine: seam.engine,
      checks,
      ...(seam.timings === undefined ? {} : { timings: seam.timings }),
    };
    await reporter.result(result);
    await reporter.done();
    return result;
  } finally {
    seam.dispose?.();
  }
}
