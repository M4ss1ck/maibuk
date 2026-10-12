// CPU throttling for race-sensitive specs. Slowing the page makes a rare
// ordering (two key presses landing in one batch) deterministic instead of
// timing-dependent. Setup-only: it changes the page's performance, never its
// state, and asserts nothing. It lives in support because the keyboard-contract
// guard forbids `newCDPSession` in `e2e/specs/`.

import type { Page } from "@playwright/test";

/**
 * Runs `run` with the page's CPU throttled by `rate` (30 = about 30x slower),
 * then always resets the throttle to 1. The CDP session is closed on the way
 * out, so a later test in the same page is not left slowed.
 */
export async function withCpuThrottle(
  page: Page,
  rate: number,
  run: () => Promise<void>
): Promise<void> {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Emulation.setCPUThrottlingRate", { rate });
    await run();
  } finally {
    await session.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    await session.detach();
  }
}
