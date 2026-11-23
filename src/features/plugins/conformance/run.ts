/**
 * The conformance route's one entry point (#447, D3). It builds the runtime
 * seam over the real Plugin lifecycle, runs every check with each result POSTed
 * to the collector as it settles, then posts the whole result and `/done`, and
 * disposes the lifecycle.
 *
 * Only `ConformancePage` calls this, and the page is imported lazily only under
 * `VITE_PLUGIN_CONFORMANCE=1` (App.tsx), so a normal build never reaches here.
 */

import { currentToastMessages } from "@/components/ui/Toast";
import { listPluginApprovals } from "@/features/plugins/approvals";
import { runConformanceChecks } from "@/features/plugins/conformance/checks";
import { createReporter } from "@/features/plugins/conformance/reporter";
import { createRuntimeSeam } from "@/features/plugins/conformance/seam";
import type { ConformanceResult } from "@/features/plugins/conformance/types";

export async function runConformance(): Promise<ConformanceResult> {
  const reporter = createReporter();
  // First, before the seam runs anything, so the report shows the state the app
  // launched with: the Plugins it knows and the notices it is showing (#922).
  await reporter.launch({
    plugins: listPluginApprovals().map((approval) => ({
      id: approval.pluginId,
      enabled: approval.enabled,
    })),
    notices: currentToastMessages(),
  });
  const seam = await createRuntimeSeam({
    heartbeat: () => reporter.heartbeat(),
    leaks: () => reporter.leaks(),
  });
  try {
    const checks = await runConformanceChecks(seam, (check) => reporter.progress(check));
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
