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
import { runConformanceChecks } from "@/features/plugins/conformance/checks";
import { createReporter } from "@/features/plugins/conformance/reporter";
import { createRuntimeSeam, readEngine, readPlatform } from "@/features/plugins/conformance/seam";
import type { ConformanceResult } from "@/features/plugins/conformance/types";

export async function runConformance(): Promise<ConformanceResult> {
  const reporter = createReporter();
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
      await new Promise((resolve) => setTimeout(resolve, PLUGIN_BLAME_WINDOW_MS + 2_000));
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
