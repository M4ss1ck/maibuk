/**
 * The gate for User Timing marks (#448).
 *
 * A mark costs a `performance.*` call and only a devtools profile or the
 * production `bench:plugins` runner reads it, so every mark is guarded by one
 * predicate: development, or a production build made with
 * `VITE_PLUGIN_BENCH=1`. When the gate is off the guarded call is never made,
 * so a shipped build pays nothing.
 *
 * `VITE_PLUGIN_BENCH` is read inline so Rollup replaces it statically: in a
 * normal build the expression folds to `DEV` alone and the guarded block is
 * dropped.
 */
export function benchMarksEnabled(): boolean {
  return import.meta.env.DEV || import.meta.env.VITE_PLUGIN_BENCH === "1";
}

/**
 * The User Timing measure name one Plugin's highlight updates are recorded
 * under (#451). One source, shared by `editor-host.ts` (which emits it) and the
 * `bench:plugins` spec (which reads it), so the two never drift.
 */
export function pluginHighlightsMeasureName(pluginId: string): string {
  return `plugin.highlights:${pluginId}`;
}
