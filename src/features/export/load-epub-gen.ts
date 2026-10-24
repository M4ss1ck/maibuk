/**
 * Loads the epub-gen-memory browser bundle without leaving SharedArrayBuffer
 * replaced. The bundle assigns a stub object to window.SharedArrayBuffer at
 * load, which breaks SQLite WASM's instanceof check in its bootstrap (#646).
 * Guarding at load instead of patching the bundle keeps upgrades of
 * epub-gen-memory working.
 */
export async function loadEpubGen() {
  const real = globalThis.SharedArrayBuffer;
  if (typeof real === "function") {
    // The bundle is "use strict", so a plain data property would throw on
    // assignment. A no-op setter swallows the stub instead.
    Object.defineProperty(globalThis, "SharedArrayBuffer", {
      configurable: true,
      get: () => real,
      set: () => {},
    });
  }
  try {
    const mod = await import("epub-gen-memory/bundle");
    return mod.default;
  } finally {
    if (typeof real === "function") {
      Object.defineProperty(globalThis, "SharedArrayBuffer", {
        configurable: true,
        writable: true,
        value: real,
      });
    }
  }
}
