import type { Locator } from "@playwright/test";

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
