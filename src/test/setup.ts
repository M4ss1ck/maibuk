// The jest-dom matcher types; the matchers load below, only under a DOM.
import type {} from "@testing-library/jest-dom/vitest";
import { Blob as NodeBlob } from "node:buffer";
import { createRequire } from "node:module";
import { relative } from "node:path";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { ASYNC_UTIL_TIMEOUT_MS, allowedTimeouts, TEST_TIMEOUT_MS } from "@/test/time-budget";

// `vi.waitFor` and `vi.waitUntil` give up after 1 s by default, a limit a busy
// CI runner crosses while the condition is still on its way. They get the same
// limit as `waitFor` / `findBy*`; a wait that passes its own options keeps them.
const viWaitFor = vi.waitFor;
const viWaitUntil = vi.waitUntil;
vi.waitFor = ((callback, options) =>
  viWaitFor(callback, options ?? { timeout: ASYNC_UTIL_TIMEOUT_MS })) as typeof vi.waitFor;
vi.waitUntil = ((callback, options) =>
  viWaitUntil(callback, options ?? { timeout: ASYNC_UTIL_TIMEOUT_MS })) as typeof vi.waitUntil;

// A test picks no timeout of its own: a raise for one slow file is how the
// suite ended up at the edge of every limit (src/test/time-budget.ts).
beforeEach(({ task }) => {
  const file = relative(process.cwd(), task.file.filepath);
  const allowed = allowedTimeouts(file);
  if (!allowed.includes(task.timeout)) {
    throw new Error(
      `"${task.name}" runs with a ${task.timeout} ms timeout. Tests use the suite's ${TEST_TIMEOUT_MS} ms budget: remove the override, or make the test cheaper. A file that truly needs longer goes in TIMEOUT_EXCEPTIONS (src/test/time-budget.ts) with its reason.`
    );
  }
});

// The rest is for jsdom suites. A Node suite (every `.test.ts` without a
// `// @vitest-environment jsdom` docblock) has no DOM, so it skips the
// polyfills and does not pay to import Testing Library, jest-dom, or axe.
if (typeof window !== "undefined") {
  await import("@testing-library/jest-dom/vitest");
  const { cleanup, configure } = await import("@testing-library/react");
  // vitest-axe exports toHaveNoViolations via export type* in the .d.ts
  // barrel but as a value in the dist .js; import from the dist path
  // to satisfy both runtime and type-check.
  const { toHaveNoViolations } = await import("vitest-axe/dist/matchers");
  expect.extend({ toHaveNoViolations });
  configure({ asyncUtilTimeout: ASYNC_UTIL_TIMEOUT_MS });

  // Polyfill getClientRects for TipTap/ProseMirror in jsdom
  // ProseMirror calls this during scrollToSelection / dispatch, which crashes in jsdom
  if (typeof Element.prototype.getClientRects !== "function") {
    Element.prototype.getClientRects = () =>
      ({
        length: 0,
        item: () => null,
        [Symbol.iterator]: function* () {},
      }) as unknown as DOMRectList;
  }

  // jsdom is pinned exactly: this reads a file it does not export.
  // Vitest 4 copies a jsdom Blob into a Node Blob for URL.createObjectURL
  // through an own Symbol("impl") that jsdom 30.1 dropped, so the call throws.
  // This reads the bytes the way Vitest 5 does; drop it with that upgrade.
  const { implForWrapper } = createRequire(import.meta.url)("jsdom/lib/generated/idl/utils.js");
  const nodeCreateObjectURL: (blob: NodeBlob) => string =
    Object.getPrototypeOf(URL).createObjectURL;
  const createObjectURL = URL.createObjectURL;
  URL.createObjectURL = (object) =>
    object instanceof Blob
      ? nodeCreateObjectURL(new NodeBlob([implForWrapper(object)._bytes], { type: object.type }))
      : createObjectURL(object);

  // jsdom has no Element.scrollIntoView; revealing a virtualized row calls it
  // from an animation frame, where a missing method throws unhandled. Tests
  // that assert the scroll replace this no-op with their own spy.
  if (typeof Element !== "undefined" && typeof Element.prototype.scrollIntoView !== "function") {
    Element.prototype.scrollIntoView = () => {};
  }

  // ProseMirror's scrollIntoView wraps a Text node in a Range; jsdom's Range has
  // no layout methods, so focusing an editor there would throw unhandled.
  if (typeof Range !== "undefined" && typeof Range.prototype.getClientRects !== "function") {
    Range.prototype.getClientRects = () =>
      ({
        length: 0,
        item: () => null,
        [Symbol.iterator]: function* () {},
      }) as unknown as DOMRectList;
    Range.prototype.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: 0,
        height: 0,
        toJSON: () => ({}),
      }) as DOMRect;
  }

  // Polyfill ResizeObserver for accessible UI components in jsdom
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof globalThis.ResizeObserver;
  }

  // Polyfill matchMedia for theme-related code (applyTheme uses it)
  if (typeof window.matchMedia === "undefined") {
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList;
  }

  // Ensure DOM is cleaned up between tests (React Testing Library auto-cleanup)
  afterEach(() => {
    cleanup();
  });

  // React Aria keeps the page's one keyboard drag in a module variable, and
  // the drag hides everything outside its drop targets. A test that ends with
  // a drag still running (it failed mid-drag, or pressed Escape before the
  // drag's first frame; `waitForKeyboardDrag` in support/drag-events.ts)
  // would hide every later test's screen, and the rest of the file would fail
  // with "Unable to find an accessible element". End the drag here and fail
  // the test that left it.
  const { endLeakedKeyboardDrag } = await import("@/test/support/drag-events");
  afterEach(async () => {
    const leaked = await endLeakedKeyboardDrag();
    if (!leaked) return;
    throw new Error(
      leaked === "ended"
        ? "A React Aria keyboard drag was still running when the test ended. Drop or cancel it, and wait for it to start (waitForKeyboardDrag) and end (endKeyboardDrag) in src/test/support/drag-events.ts."
        : "A React Aria keyboard drag was still running when the test ended, with animation frames faked, so it could not be cancelled and later tests in this file may fail. End the drag and call vi.useRealTimers() before the test ends."
    );
  });
}
