// Waiting for deferred launch work. App startup schedules non-essential work
// (the approved-Plugins scan) with requestIdleCallback after the first render,
// so an assertion made as soon as the first paint is visible can race it.
// Setup-only, like the storage helpers: page script, never an assertion
// surface.

import type { Page } from "@playwright/test";

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
