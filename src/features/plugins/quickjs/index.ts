/**
 * The Android QuickJS Plugin engine (#516, ADR 0019). `runQuickJsPlugin` is the
 * only seam callers need: give it the verified module graph, an entry, and the
 * Worker global scope, and it reports `ready`, `error`, or `memory-death`.
 *
 * Nothing in this module imports DOM-only code, so it loads in a sandbox
 * Worker, in Node, and in Vitest.
 */

export {
  QUICKJS_HEAP_CAP_BYTES,
  QUICKJS_MEMORY_DEATH_MESSAGE,
  QUICKJS_WASM_HEADROOM_BYTES,
  QUICKJS_WASM_INITIAL_PAGES,
  QUICKJS_WASM_PAGE_BYTES,
  quickJsWasmMaximumPages,
} from "@/features/plugins/quickjs/constants";
export { runQuickJsPlugin } from "@/features/plugins/quickjs/runner";
export type {
  QuickJsPluginEndpoint,
  QuickJsPluginRun,
  QuickJsRunOptions,
  QuickJsRunOutcome,
  QuickJsScopeEvent,
} from "@/features/plugins/quickjs/runner";
