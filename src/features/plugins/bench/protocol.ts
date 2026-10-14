/**
 * The Plugins bench driver's wire contract (issue #448).
 *
 * The `bench:plugins` WebKitGTK lane builds the app with
 * `VITE_PLUGIN_BENCH_DRIVER=1`; the gated driver then reads one seed file from
 * the app data dir, seeds the approvals it carries, measures the seeded mode,
 * and POSTs the samples to the runner's collector. The paths live here so the
 * driver and the runner's collector cannot drift, exactly as the conformance
 * reporter's paths do (`CONFORMANCE_COLLECTOR_PATHS`).
 *
 * The seed file is in the app data dir, never the Plugin Directory (ADR 0020),
 * and every launch reads its own fresh one.
 */

/** The seed file the runner writes into the app data dir before each launch. */
export const BENCH_SEED_FILE = "plugins-bench-seed.json";

/** The collector the driver posts to, on the runner's `127.0.0.1` collector. */
export const BENCH_COLLECTOR_PATHS = {
  /** `POST` one measurement: `{ mode, samples }`. */
  measure: "/bench/measure",
  /** `POST` an empty body once the measurement is over. */
  done: "/bench/done",
} as const;
