import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, expect } from "vitest";
// vitest-axe exports toHaveNoViolations via export type* in the .d.ts
// barrel but as a value in the dist .js; import from the dist path
// to satisfy both runtime and type-check.
import { toHaveNoViolations } from "vitest-axe/dist/matchers";

expect.extend({ toHaveNoViolations });

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
