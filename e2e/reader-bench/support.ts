// Shared helpers for the Reader performance lane (`pnpm bench:reader`, issue
// #653). The specs are measurements, not behaviour tests: they drive Reader the
// way the reader spec does (keyboard only, the same helpers, the same picker
// double) and write what they measured as JSON into READER_BENCH_OUT. The
// runner (e2e/run-reader-bench.ts) judges the numbers.
import type { FrameLocator, Page } from "@playwright/test";
import { leaveFrame, pressUntilFocused, tabTo } from "../support/keyboard";
import { runPaletteCommand } from "../support/palette";
import { expect } from "../support/test";

/** Where the specs write their JSON; the runner sets it and refuses a direct run. */
export function benchOut(): string {
  const out = process.env.READER_BENCH_OUT;
  if (!out) {
    throw new Error(
      "Run the Reader bench with `pnpm bench:reader`, never `playwright test` directly"
    );
  }
  return out;
}

export const navOption = (page: Page, name: string) =>
  page
    .getByRole("listbox", { name: "Primary navigation" })
    .getByRole("option", { name: new RegExp(`^${name}`) });

export const frameElement = (page: Page) => page.locator('[data-plugin-frame="page"] iframe');
export const documentFrame = (page: Page): FrameLocator =>
  page.frameLocator('[data-plugin-frame="page"] iframe');
export const pageIndicator = (page: Page) => documentFrame(page).locator("#page-indicator");

/**
 * The Reader Frame's own document: the child frame that holds the page
 * indicator. The Shelf's Plugin frame is a child frame too, so "the first
 * child" would pick the wrong document and wait forever.
 */
async function readerFrame(page: Page) {
  for (const frame of page.frames()) {
    if (frame.parentFrame() === null) continue;
    if ((await frame.locator("#page-indicator").count()) > 0) return frame;
  }
  throw new Error("the Reader Frame is not in the page");
}

/** Opens Reader from the sidebar, waiting for the Plugin's launch scan (as the reader spec does). */
export async function openReader(page: Page): Promise<void> {
  await expect(navOption(page, "Reader")).toBeVisible({ timeout: 15_000 });
  await tabTo(page, navOption(page, "Books"), { max: 60 });
  await pressUntilFocused(page, "ArrowDown", navOption(page, "Reader"), { max: 20 });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/plugin\/maibuk-reader\/reader$/);
  await expect(page.getByRole("heading", { name: "Shelf", level: 2 })).toBeVisible();
}

/** Leaves Reader for the Library with the sidebar, as the reader spec does. */
export async function goHome(page: Page): Promise<void> {
  await tabTo(page, navOption(page, "Reader"), { max: 60 });
  await pressUntilFocused(page, "ArrowUp", navOption(page, "Books"), { max: 20 });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/$/);
}

/** Tabs from the host page into the Frame, so the reading keys reach it. */
export async function focusDocument(page: Page): Promise<void> {
  await expect(pageIndicator(page)).toBeVisible({ timeout: 15_000 });
  await tabTo(page, frameElement(page), { max: 60 });
}

/** Runs a palette Command from the host, leaving the Frame first (as the reader spec does). */
export async function runHostCommand(page: Page, label: string): Promise<void> {
  await leaveFrame(page, frameElement(page));
  await runPaletteCommand(page, label);
}

/** The Frame's page indicator text, read without waiting. */
export async function indicatorText(page: Page): Promise<string> {
  const frame = await readerFrame(page);
  return (await frame.locator("#page-indicator").textContent({ timeout: 5_000 })) ?? "";
}

/**
 * Waits for the Frame's first visible change after a key press: the page
 * indicator text moving, or any DOM mutation, or a scroll in the Frame. The
 * indicator alone is not a turn signal: a flowing EPUB section that fits one
 * page reads "1 of 1 in this section" on every section, so the turn shows as a
 * DOM or scroll change instead. A MutationObserver and a capture scroll listener
 * resolve on the change itself, so the wait needs no animation frames (a Frame
 * that is not painting would stall an rAF poll) and adds no poll interval to
 * the measurement. The time from the key press to here includes one Playwright
 * round trip: it is recorded, not gated.
 */
export async function waitFrameChange(page: Page, before: string): Promise<void> {
  const frame = await readerFrame(page);
  const handle = await frame.waitForFunction(
    (previous) =>
      new Promise<boolean>((resolve) => {
        const indicator = () => document.querySelector("#page-indicator")?.textContent ?? "";
        const observer = new MutationObserver(() => done());
        const onScroll = () => done();
        const done = () => {
          observer.disconnect();
          document.removeEventListener("scroll", onScroll, true);
          resolve(true);
        };
        observer.observe(document.documentElement, {
          subtree: true,
          childList: true,
          attributes: true,
          characterData: true,
        });
        document.addEventListener("scroll", onScroll, { capture: true, passive: true });
        if (indicator() !== previous) done();
      }),
    before,
    { timeout: 15_000 }
  );
  // waitForFunction returns a handle to the page's result. The bench never reads
  // it, so it is disposed here: a handle left alive per turn is page-side state
  // the heap read would count against Reader.
  await handle.dispose();
}

/** The page's `performance.now()`, the clock the long-task entries use. */
export async function nowIn(page: Page): Promise<number> {
  return page.evaluate(() => performance.now());
}

/** Collects the bench's action windows: each runs `work` and records its start and end. */
export async function timedWindow<T>(
  page: Page,
  windows: { name: string; startMs: number; endMs: number }[],
  name: string,
  work: () => Promise<T>
): Promise<{ result: T; durationMs: number }> {
  const startMs = await nowIn(page);
  const result = await work();
  const endMs = await nowIn(page);
  windows.push({ name, startMs, endMs });
  return { result, durationMs: endMs - startMs };
}

/** A JS heap reading after a forced GC, through the page's own CDP session. */
export async function heapAfterGc(page: Page): Promise<number> {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("HeapProfiler.collectGarbage");
    await session.send("HeapProfiler.collectGarbage");
    const usage = (await session.send("Runtime.getHeapUsage")) as { usedSize: number };
    return usage.usedSize;
  } finally {
    await session.detach();
  }
}
