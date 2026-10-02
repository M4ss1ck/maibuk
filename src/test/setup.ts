import "@testing-library/jest-dom/vitest";
import { relative } from "node:path";
import { cleanup, configure } from "@testing-library/react";
import { afterEach, beforeEach, expect } from "vitest";
// vitest-axe exports toHaveNoViolations via export type* in the .d.ts
// barrel but as a value in the dist .js; import from the dist path
// to satisfy both runtime and type-check.
import { toHaveNoViolations } from "vitest-axe/dist/matchers";
import { ASYNC_UTIL_TIMEOUT_MS, allowedTimeouts, TEST_TIMEOUT_MS } from "@/test/time-budget";

expect.extend({ toHaveNoViolations });

configure({ asyncUtilTimeout: ASYNC_UTIL_TIMEOUT_MS });

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

// This setup is for the jsdom suites. A `// @vitest-environment node` suite
// (the browser-free E2E coverage guard) has no DOM, so skip the polyfills.
if (typeof window !== "undefined") {
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
}
