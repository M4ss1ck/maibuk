// Waiting for deferred launch work. App startup schedules non-essential work
// (the approved-Plugins scan) with requestIdleCallback after the first render,
// so an assertion made as soon as the first paint is visible can race it.
// Setup-only, like the storage helpers: page script, never an assertion
// surface.

import type { Page } from "@playwright/test";

/**
 * Delays every idle callback by `ms` milliseconds for the rest of the page's
 * life, in every browser: the lifecycle install happens in one idle callback after the first
 * render, so a test that must hold the app in its pre-scan copy (the Plugin
 * page's loading state) parks it deterministically. Setup-only, like the
 * storage helpers: page script, never an assertion surface.
 */
export async function delayIdleWork(page: Page, ms: number): Promise<void> {
  await page.addInitScript((ms) => {
    const original = window.requestIdleCallback?.bind(window);
    // WebKit has no requestIdleCallback, so main.tsx falls back to a timeout
    // the delay would miss; a delayed stand-in holds the install there too.
    window.requestIdleCallback = (callback: IdleRequestCallback, options?: IdleRequestOptions) =>
      window.setTimeout(() => {
        if (original) original(callback, options);
        else callback({ didTimeout: false, timeRemaining: () => 0 });
      }, ms);
  }, ms);
}

/**
 * Waits until idle work scheduled before this call has certainly run: queues
 * one requestIdleCallback (callbacks run in registration order, so an earlier
 * one is done), then waits one short settle for the work it started. Falls
 * back to a macrotask where requestIdleCallback is missing, matching main.tsx.
 */
export async function waitForIdleWork(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const settle = () => setTimeout(resolve, 50);
        if (typeof window.requestIdleCallback === "function") {
          window.requestIdleCallback(settle);
        } else {
          setTimeout(settle, 0);
        }
      })
  );
}
