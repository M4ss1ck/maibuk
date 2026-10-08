// Screenshot capture points for PR evidence (CODING_STANDARDS.md, "Keyboard
// and accessibility", item 9). A spec already drives the app to the state worth showing, so
// it calls `capture` there; the call is a no-op unless E2E_CAPTURE_DIR is set,
// which keeps normal runs fast and the suite's behavior unchanged.
// scripts/pr-screenshots.sh sets it for the base and the branch.

import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./test";

const PADDING = 24;

interface CaptureOptions {
  /** Crop to the union of these elements plus padding; omit for the viewport. */
  around?: Locator[];
  /**
   * Pause every running animation this many ms in, for both shots, to show
   * motion mid-way (the Pane frame's slide). Call it right after the key
   * that starts the animation; it fails when nothing is animating.
   */
  freezeAnimationsAt?: number;
}

/**
 * Saves `<name>.<project>.light.png` and `<name>.<project>.dark.png` into
 * E2E_CAPTURE_DIR. The theme follows the device ("system" is the default, and
 * ThemeProvider listens for scheme changes), so emulating the scheme switches
 * it live without touching settings; the light scheme is restored afterwards.
 */
export async function capture(page: Page, name: string, options: CaptureOptions = {}) {
  const dir = process.env.E2E_CAPTURE_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  const project = test.info().project.name;
  const html = page.locator("html");
  const frozen = options.freezeAnimationsAt;
  if (frozen !== undefined) {
    const paused = await page.evaluate((at) => {
      const running = document.getAnimations().filter((a) => a.playState === "running");
      for (const animation of running) {
        animation.pause();
        animation.currentTime = at;
      }
      return running.length;
    }, frozen);
    if (paused === 0) throw new Error(`capture ${name}: no running animation to freeze`);
  }

  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    if (scheme === "dark") await expect(html).toHaveClass(/\bdark\b/);
    else await expect(html).not.toHaveClass(/\bdark\b/);
    await page.screenshot({
      path: resolve(dir, `${name}.${project}.${scheme}.png`),
      clip: await clipAround(page, options.around),
      animations: frozen === undefined ? "disabled" : "allow",
      caret: "hide",
    });
  }
  await page.emulateMedia({ colorScheme: "light" });
  if (frozen !== undefined) {
    await page.evaluate(() => {
      for (const animation of document.getAnimations()) animation.finish();
    });
  }
}

async function clipAround(page: Page, around: Locator[] | undefined) {
  if (!around?.length) return undefined;
  const boxes = await Promise.all(around.map((locator) => locator.boundingBox()));
  const found = boxes.filter((box) => box !== null);
  if (found.length === 0) throw new Error("capture: none of the `around` elements is visible");
  const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
  const x = Math.max(0, Math.min(...found.map((b) => b.x)) - PADDING);
  const y = Math.max(0, Math.min(...found.map((b) => b.y)) - PADDING);
  const right = Math.min(viewport.width, Math.max(...found.map((b) => b.x + b.width)) + PADDING);
  const bottom = Math.min(viewport.height, Math.max(...found.map((b) => b.y + b.height)) + PADDING);
  return { x, y, width: right - x, height: bottom - y };
}
