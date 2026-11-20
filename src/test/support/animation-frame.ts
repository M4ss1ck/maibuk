import { vi } from "vitest";

/**
 * Runs each animation frame's callback in a microtask instead of synchronously.
 * A synchronous frame would run React Aria FocusScope's refocus inside the
 * focusout, and jsdom 31, like browsers, lets that refocus win. The caller's
 * `vi.unstubAllGlobals()` restores the real frame.
 */
export function deferAnimationFrames() {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    queueMicrotask(() => callback(0));
    return 0;
  });
}
