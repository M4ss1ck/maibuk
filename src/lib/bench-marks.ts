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
