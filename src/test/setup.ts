import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Polyfill ResizeObserver for Headless UI components in jsdom
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() { }
    unobserve() { }
    disconnect() { }
  } as unknown as typeof globalThis.ResizeObserver;
}

// Ensure DOM is cleaned up between tests (React Testing Library auto-cleanup)
afterEach(() => {
  cleanup();
});
