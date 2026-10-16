/**
 * Constants for the Android QuickJS Plugin engine (#516, ADR 0019). Nothing here
 * touches the DOM: the runner, its globals, and its port bridge load in a
 * sandbox Worker, in Node, and in Vitest.
 */

/** The QuickJS heap one Plugin may allocate before it dies, in bytes (64 MiB). */
export const QUICKJS_HEAP_CAP_BYTES = 64 * 1024 * 1024;

/**
 * Fixed headroom above the heap cap for the interpreter's own Wasm allocations
 * (32 MiB). The Wasm memory maximum is the cap plus this, so a Plugin that
 * reaches the cap dies of a QuickJS out-of-memory rather than of a Wasm
 * memory-growth abort.
 */
export const QUICKJS_WASM_HEADROOM_BYTES = 32 * 1024 * 1024;

/** The Wasm linear-memory page size, in bytes. */
export const QUICKJS_WASM_PAGE_BYTES = 64 * 1024;

/**
 * The page count the chosen variant (`@jitl/quickjs-ng-wasmfile-release-sync`)
 * declares as its own initial memory. A `WebAssembly.Memory` passed as
 * `wasmMemory` must be at least this large, or instantiation fails with a
 * LinkError ("memory import has N pages which is smaller than the declared
 * initial of 256").
 */
export const QUICKJS_WASM_INITIAL_PAGES = 256;

/**
 * The Wasm memory maximum, in 64 KiB pages, for a given heap cap: the cap plus
 * the fixed interpreter headroom.
 */
export function quickJsWasmMaximumPages(heapCapBytes: number): number {
  return Math.ceil((heapCapBytes + QUICKJS_WASM_HEADROOM_BYTES) / QUICKJS_WASM_PAGE_BYTES);
}

/**
 * The message a QuickJS out-of-memory becomes. `lifecycle.ts`'s
 * `workerStopReason` matches `/out[- ]of[- ]memory/i`, so this string must
 * contain "out of memory".
 */
export const QUICKJS_MEMORY_DEATH_MESSAGE = "QuickJS out of memory";
