// Touch gestures Playwright has no API for, for the `phone` project only.
// `locator.tap()` covers a tap; a long-press and a swipe need touch points
// held and moved, which Chromium accepts over CDP (Input.dispatchTouchEvent).
// The coverage guard lets only @touch specs import this file.

import type { CDPSession, Locator, Page } from "@playwright/test";

/** React Aria's long-press threshold is 500 ms; hold past it with margin. */
const LONG_PRESS_MS = 800;

const sessions = new WeakMap<Page, CDPSession>();

async function cdp(page: Page): Promise<CDPSession> {
  const existing = sessions.get(page);
  if (existing) return existing;
  const browser = page.context().browser()?.browserType().name();
  if (browser !== "chromium") {
    throw new Error(`touch gestures need Chromium (CDP); this project runs ${browser}`);
  }
  const session = await page.context().newCDPSession(page);
  sessions.set(page, session);
  return session;
}

async function center(target: Locator): Promise<{ x: number; y: number }> {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error(`touch target is not visible: ${target}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function point(at: { x: number; y: number }) {
  // A finger has an area and pressure; React Aria reads a 0x0 pointer with no
  // pressure as a virtual (screen reader) press.
  return { x: at.x, y: at.y, id: 1, radiusX: 8, radiusY: 8, force: 1 };
}

/**
 * Holds a finger on `target` past the long-press threshold, then lifts it the
 * way a phone ends a long-press. Chromium's desktop touch emulation has no
 * long-press gesture: a finger lifted after any hold still becomes a tap, with
 * a compatibility mousedown and click that a phone never sends after a
 * long-press. The touch is cancelled instead, so no such tap follows.
 */
export async function longPress(page: Page, target: Locator): Promise<void> {
  const session = await cdp(page);
  const at = await center(target);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [point(at)],
  });
  await page.waitForTimeout(LONG_PRESS_MS);
  await session.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
}

/** A quick finger swipe from `from` to `to`, without a hold first. */
export async function swipe(page: Page, from: Locator, to: Locator): Promise<void> {
  const session = await cdp(page);
  const start = await center(from);
  const end = await center(to);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [point(start)],
  });
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        point({
          x: start.x + ((end.x - start.x) * i) / steps,
          y: start.y + ((end.y - start.y) * i) / steps,
        }),
      ],
    });
  }
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
