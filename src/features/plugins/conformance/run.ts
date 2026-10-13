/**
 * The conformance route's one entry point (#447, D3). It builds the runtime
 * seam over the real Plugin lifecycle, runs every check with each result POSTed
 * to the collector as it settles, then posts the whole result and `/done`, and
 * disposes the lifecycle.
 *
 * Only `ConformancePage` calls this, and the page is imported lazily only under
 * `VITE_PLUGIN_CONFORMANCE=1` (App.tsx), so a normal build never reaches here.
 */

import { runConformanceChecks } from "@/features/plugins/conformance/checks";
import { createReporter } from "@/features/plugins/conformance/reporter";
import { createRuntimeSeam } from "@/features/plugins/conformance/seam";
import type { ConformanceResult } from "@/features/plugins/conformance/types";

export async function runConformance(): Promise<ConformanceResult> {
  const reporter = createReporter();
  const seam = await createRuntimeSeam({
    heartbeat: () => reporter.heartbeat(),
    leaks: () => reporter.leaks(),
  });
  try {
    const checks = await runConformanceChecks(seam, (check) => reporter.progress(check));
    const result: ConformanceResult = { engine: seam.engine, checks };
    await reporter.result(result);
    await reporter.done();
    return result;
  } finally {
    seam.dispose?.();
  }
}
