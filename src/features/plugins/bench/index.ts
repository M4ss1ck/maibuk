/**
 * The Plugins bench driver's module (issue #448, unit 4b). `main.tsx` imports
 * it dynamically, and only in a build made with `VITE_PLUGIN_BENCH_DRIVER=1`,
 * so a normal build never reaches it and the whole measurement graph stays out
 * of a shipped bundle.
 */
export { preparePluginsBench, getPluginsBenchSeed, readBenchSeed } from "@/features/plugins/bench/seed";
export { runPluginsBenchDriver } from "@/features/plugins/bench/driver";
export { diag } from "@/features/plugins/bench/diag";
