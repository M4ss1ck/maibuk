// The page the frame-rate scenario drivers act on (issue #374). Playwright
// drives the web and Android sources; the desktop source drives the Tauri
// binary over WebDriver, which has no Playwright Page. Both implement this
// narrow surface, so `drivers.ts` stays one copy for every source.
//
// A locator is lazy, like Playwright's: it names a chain of steps and resolves
// on every call. Everything the drivers ask of an element reduces to
// `evaluate` on its first match, plus `count`.

import type { Locator, Page } from "@playwright/test";

export interface RoleOptions {
  /** Accessible name; a string matches case-insensitively as a substring unless `exact`. */
  name?: string | RegExp;
  exact?: boolean;
  selected?: boolean;
  /** Heading level. */
  level?: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FrameLocator {
  getByRole(role: string, options?: RoleOptions): FrameLocator;
  locator(css: string): FrameLocator;
  first(): FrameLocator;
  /** Only the matches that are visible. */
  visible(): FrameLocator;
  /**
   * Runs `fn` on the first match; rejects when nothing matches. `fn` is
   * serialized into the page, so it reaches outside data only through `arg`.
   */
  evaluate<R, A = undefined>(fn: (el: Element, arg: A) => R, arg?: A): Promise<R>;
  count(): Promise<number>;
  /** For error messages. */
  toString(): string;
}

export interface FramePage {
  keyboard: {
    /** Playwright key syntax: "Enter", "Shift+F6", "ControlOrMeta+End". */
    press(key: string): Promise<void>;
    type(text: string, options?: { delay?: number }): Promise<void>;
  };
  mouse: {
    move(x: number, y: number): Promise<void>;
    down(): Promise<void>;
    up(): Promise<void>;
    wheel(dx: number, dy: number): Promise<void>;
  };
  evaluate<R, A = undefined>(fn: (arg: A) => R | Promise<R>, arg?: A): Promise<R>;
  getByRole(role: string, options?: RoleOptions): FrameLocator;
  getByText(text: string, options?: { exact?: boolean }): FrameLocator;
  locator(css: string): FrameLocator;
  /** Navigates to an app path on whatever origin serves the app. */
  goto(path: string): Promise<void>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Polls `check` until it holds, every 50 ms, or throws `message` after
 * `timeout` ms. The default matches the frames config's expect timeout.
 */
export async function waitUntil(
  check: () => Promise<boolean>,
  message: string,
  timeout = 10_000
): Promise<void> {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await check().catch(() => false)) return;
    if (Date.now() > deadline) throw new Error(`timed out after ${timeout} ms: ${message}`);
    await sleep(50);
  }
}

/** Whether the element has a box and is not hidden by CSS. */
function elementVisible(el: Element): boolean {
  // Serialized into the page, so the recursion is an inner function, not a
  // module helper. Playwright's rule: a `display: contents` element has no
  // box of its own and is visible when any child is (the palette's dialog).
  const visible = (node: Element): boolean => {
    const style = getComputedStyle(node);
    if (style.display === "contents") return Array.from(node.children).some(visible);
    const rect = node.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    return style.visibility !== "hidden" && style.display !== "none";
  };
  return visible(el);
}

export const isVisible = (target: FrameLocator) =>
  target.evaluate(elementVisible).catch(() => false);
export const isFocused = (target: FrameLocator) =>
  target.evaluate((el) => el === document.activeElement).catch(() => false);
export const isFocusWithin = (region: FrameLocator) =>
  region.evaluate((el) => el.contains(document.activeElement)).catch(() => false);

export const waitVisible = (target: FrameLocator, timeout?: number) =>
  waitUntil(() => isVisible(target), `${target} visible`, timeout);
export const waitHidden = (target: FrameLocator, timeout?: number) =>
  waitUntil(async () => !(await isVisible(target)), `${target} hidden`, timeout);
export const waitFocused = (target: FrameLocator, timeout?: number) =>
  waitUntil(() => isFocused(target), `${target} focused`, timeout);
export const waitFocusWithin = (region: FrameLocator, timeout?: number) =>
  waitUntil(() => isFocusWithin(region), `focus within ${region}`, timeout);
export const waitCount = (target: FrameLocator, count: number, timeout?: number) =>
  waitUntil(async () => (await target.count()) === count, `${target} count ${count}`, timeout);
export const waitAttribute = (
  target: FrameLocator,
  name: string,
  value: string,
  timeout?: number
) =>
  waitUntil(
    async () => (await target.evaluate((el, attr) => el.getAttribute(attr), name)) === value,
    `${target} [${name}="${value}"]`,
    timeout
  );

/** The element's box in viewport coordinates; rejects when nothing matches. */
export const boundingBox = (target: FrameLocator): Promise<Box> =>
  target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });

async function describeFocus(page: FramePage): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return "<body>";
    const label = el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 40) ?? "";
    return `${el.tagName.toLowerCase()}${el.getAttribute("role") ? `[role=${el.getAttribute("role")}]` : ""} "${label}"`;
  });
}

/** Presses Tab (or Shift+Tab) until `target` has focus; see e2e/support/keyboard.ts. */
export async function tabTo(
  page: FramePage,
  target: FrameLocator,
  { max = 40, backwards = false }: { max?: number; backwards?: boolean } = {}
): Promise<void> {
  await pressUntilFocused(page, backwards ? "Shift+Tab" : "Tab", target, { max });
}

/** Presses `key` until `target` has focus: movement inside a roving-focus group. */
export async function pressUntilFocused(
  page: FramePage,
  key: string,
  target: FrameLocator,
  { max = 20 }: { max?: number } = {}
): Promise<void> {
  const visited: string[] = [];
  for (let i = 0; i < max; i++) {
    if (await isFocused(target)) return;
    await page.keyboard.press(key);
    visited.push(await describeFocus(page));
  }
  if (await isFocused(target)) return;
  throw new Error(`${key} never reached ${target}. Visited:\n  ${visited.join("\n  ")}`);
}

function playwrightLocator(locator: Locator): FrameLocator {
  return {
    getByRole: (role, options) =>
      playwrightLocator(locator.getByRole(role as Parameters<Locator["getByRole"]>[0], options)),
    locator: (css) => playwrightLocator(locator.locator(css)),
    first: () => playwrightLocator(locator.first()),
    visible: () => playwrightLocator(locator.filter({ visible: true })),
    // Strict, like the `expect` and Locator calls this adapter replaced: a
    // locator matching two elements throws instead of picking one. The short
    // timeout keeps one poll of `waitUntil` from blocking its deadline.
    evaluate: (fn, arg) => locator.evaluate(fn as never, arg, { timeout: 1_000 }) as never,
    count: () => locator.count(),
    toString: () => String(locator),
  };
}

/** The Playwright Page as a FramePage: a pass-through. */
export function playwrightFramePage(page: Page, open: (path: string) => Promise<void>): FramePage {
  return {
    keyboard: {
      press: (key) => page.keyboard.press(key),
      type: (text, options) => page.keyboard.type(text, options),
    },
    mouse: {
      move: (x, y) => page.mouse.move(x, y),
      down: () => page.mouse.down(),
      up: () => page.mouse.up(),
      wheel: (dx, dy) => page.mouse.wheel(dx, dy),
    },
    evaluate: (fn, arg) => page.evaluate(fn as never, arg) as never,
    getByRole: (role, options) =>
      playwrightLocator(page.getByRole(role as Parameters<Page["getByRole"]>[0], options)),
    getByText: (text, options) => playwrightLocator(page.getByText(text, options)),
    locator: (css) => playwrightLocator(page.locator(css)),
    goto: open,
  };
}
