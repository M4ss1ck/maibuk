/**
 * The QuickJS runner's bundle entry (#516): the sandbox frame imports this one
 * module inside the Android sandbox Worker, built as a standalone ES module by
 * Vite (`?worker&url` in `host-assets.ts`) and fetched by the host as text. It
 * re-exports the runner seam (`runQuickJsPlugin`) and nothing else; the module
 * graph keys and the Wasm module arrive on the boot message as data.
 */

export { runQuickJsPlugin } from "@/features/plugins/quickjs/runner";
export type {
  QuickJsPluginEndpoint,
  QuickJsPluginRun,
  QuickJsRunOptions,
  QuickJsRunOutcome,
  QuickJsScopeEvent,
} from "@/features/plugins/quickjs/runner";
