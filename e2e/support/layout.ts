import type { Locator, Page } from "@playwright/test";

/** How far the nearest scrolling ancestor of `element` is scrolled. */
export function scrollTopAround(element: Locator): Promise<number> {
  return element.evaluate((start) => {
    let node: HTMLElement | null = start.parentElement;
    while (node && node.scrollHeight <= node.clientHeight) node = node.parentElement;
    return node?.scrollTop ?? 0;
  });
}

/** Vertical center of `element`'s first line box, in viewport pixels. */
export function firstLineCenter(element: Locator): Promise<number> {
  return element.evaluate((target) => {
    const lineHeight = Number.parseFloat(getComputedStyle(target).lineHeight);
    return target.getBoundingClientRect().top + lineHeight / 2;
  });
}

/** Vertical center of `element`'s box, in viewport pixels. */
export function boxCenter(element: Locator): Promise<number> {
  return element.evaluate((target) => {
    const box = target.getBoundingClientRect();
    return box.top + box.height / 2;
  });
}

/**
 * Starts watching the page for `text`, and returns a check that says whether it
 * was ever on screen since, even for a single frame between two assertions
 * (a loading screen that flashes and goes).
 */
export async function watchForText(page: Page, text: string): Promise<() => Promise<boolean>> {
  const flag = `__sawText${Math.random().toString(36).slice(2)}`;
  await page.evaluate(
    ({ flag, text }) => {
      const record = window as unknown as Record<string, boolean>;
      record[flag] = document.body.textContent?.includes(text) ?? false;
      new MutationObserver(() => {
        if (document.body.textContent?.includes(text)) record[flag] = true;
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    },
    { flag, text }
  );
  return () =>
    page.evaluate((flag) => (window as unknown as Record<string, boolean>)[flag] === true, flag);
}

/** Animations running on `element` and its descendants right now. */
export function runningAnimationCount(element: Locator): Promise<number> {
  return element.evaluate((target) => target.getAnimations({ subtree: true }).length);
}
