import { expect, type Locator, type Page } from "@playwright/test";

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

/**
 * Reads a control's focus ring: its outline style, how far the ring is drawn
 * outside the border box, and the sides an ancestor's overflow clips. The ring
 * is drawn `outline-width + outline-offset` outside the box, so a clipping
 * ancestor cuts it off unless its padding box leaves that much room. A scroll
 * box such as the sidebar's destinations section is one: its edges cap the ring
 * of every row inside it, while rows outside it draw a whole one.
 */
async function readFocusRing(
  element: Locator
): Promise<{ outlineStyle: string; overhang: number; sides: string[] }> {
  return element.evaluate((el) => {
    const style = getComputedStyle(el);
    const overhang = Number.parseFloat(style.outlineWidth) + Number.parseFloat(style.outlineOffset);
    const box = el.getBoundingClientRect();
    let left = Number.NEGATIVE_INFINITY;
    let top = Number.NEGATIVE_INFINITY;
    let right = Number.POSITIVE_INFINITY;
    let bottom = Number.POSITIVE_INFINITY;
    for (let ancestor = el.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const overflow = getComputedStyle(ancestor);
      if (overflow.overflowX === "visible" && overflow.overflowY === "visible") continue;
      const rect = ancestor.getBoundingClientRect();
      // clientLeft/clientWidth describe the padding box, where overflow clips.
      left = Math.max(left, rect.left + ancestor.clientLeft);
      top = Math.max(top, rect.top + ancestor.clientTop);
      right = Math.min(right, rect.left + ancestor.clientLeft + ancestor.clientWidth);
      bottom = Math.min(bottom, rect.top + ancestor.clientTop + ancestor.clientHeight);
    }
    const sides: string[] = [];
    // The clip box comes from clientWidth/clientHeight, which CSSOM rounds to
    // integers; the row's rect keeps fractions. Half a pixel absorbs the
    // rounding without hiding a real clip.
    const epsilon = 0.5;
    if (box.left - overhang < left - epsilon) sides.push("left");
    if (box.right + overhang > right + epsilon) sides.push("right");
    if (box.top - overhang < top - epsilon) sides.push("top");
    if (box.bottom + overhang > bottom + epsilon) sides.push("bottom");
    return { outlineStyle: style.outlineStyle, overhang, sides };
  });
}

/**
 * Focus lands before the list scrolls the row into view, so the box can still
 * be on its way for a frame or two. Waits until it holds the same place for a
 * frame, then reads the ring.
 */
async function waitForBoxToSettle(element: Locator): Promise<boolean> {
  const page = element.page();
  let previous = "";
  for (let frame = 0; frame < 8; frame += 1) {
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    );
    const box = await element.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return `${rect.left},${rect.top},${rect.width},${rect.height}`;
    });
    if (box === previous) return true;
    previous = box;
  }
  return false;
}

/**
 * A focused control draws its ring, and no clipping ancestor cuts a side of
 * it. Soft, so a Before screenshot run reaches its capture points even when the
 * fix's new assertions fail on the base.
 */
export async function expectFocusRingUnclipped(element: Locator, name: string) {
  if (!(await waitForBoxToSettle(element))) {
    throw new Error(`${name}'s box never settled; cannot judge its focus ring`);
  }
  const ring = await readFocusRing(element);
  expect.soft(ring.outlineStyle, `${name} draws a focus ring`).not.toBe("none");
  expect.soft(ring.overhang, `${name} draws its ring outside its box`).toBeGreaterThan(0);
  expect.soft(ring.sides, `${name}'s focus ring is cut off`).toEqual([]);
}

/**
 * Starts watching `editor` for a Dictation partial on its still-empty first
 * line, and returns the placeholder's `::before` content at every moment one
 * showed. Partials come and go faster than a poll, so each mutation records.
 */
export async function watchPlaceholderUnderPartial(
  editor: Locator
): Promise<() => Promise<string[]>> {
  const key = `__placeholderUnderPartial${Math.random().toString(36).slice(2)}`;
  await editor.evaluate((root, key) => {
    const seen: string[] = [];
    (window as unknown as Record<string, string[]>)[key] = seen;
    new MutationObserver(() => {
      const line = root.querySelector("p.is-editor-empty:first-child");
      if (line?.querySelector(".dictation-partial")) {
        seen.push(getComputedStyle(line, "::before").content);
      }
    }).observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
  }, key);
  return () =>
    editor.page().evaluate((key) => (window as unknown as Record<string, string[]>)[key], key);
}

/**
 * Whether `floating` stacks above `overlay`: the z-index each computes, as
 * both are portalled straight under <body> and share its stacking context. A
 * React Aria Popover carries an inline z-index, so a Tooltip inside one has to
 * clear it or it paints behind the Popover it explains.
 */
export async function stacksAbove(floating: Locator, overlay: Locator): Promise<boolean> {
  const overlayZ = await overlay.evaluate((el) => Number(getComputedStyle(el).zIndex));
  const floatingZ = await floating.evaluate((el) => Number(getComputedStyle(el).zIndex));
  return floatingZ > overlayZ;
}

/**
 * What paints at the top edge of `child`, when it is not `child` itself: the
 * class of the element covering it, or null when nothing does. A badge that
 * rises past its row's top edge can be painted over by the row above it.
 * Ignores `pointer-events: none` on `child`, which hit testing would skip.
 */
export function coveredTopEdge(child: Locator): Promise<string | null> {
  return child.evaluate((el) => {
    const target = el as HTMLElement;
    const previous = target.style.pointerEvents;
    target.style.pointerEvents = "auto";
    const box = target.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + 1);
    target.style.pointerEvents = previous;
    return target.contains(hit) ? null : String(hit?.className ?? "nothing");
  });
}

/**
 * How far the center of `text`'s box sits from the center of `icon`'s box, and
 * whether the text box is trimmed below its line height. An uppercase label
 * centered on its line box puts its caps above the icon beside it; trimmed to
 * the cap height (`text-box`), its box is the caps, so equal centers mean the
 * icon is centered on the letters.
 */
export async function capCenterOffset(
  text: Locator,
  icon: Locator
): Promise<{ offset: number; trimmed: boolean }> {
  const read = (el: Element) => {
    const box = el.getBoundingClientRect();
    return {
      center: box.top + box.height / 2,
      height: box.height,
      lineHeight: Number.parseFloat(getComputedStyle(el).lineHeight),
    };
  };
  const t = await text.evaluate(read);
  const i = await icon.evaluate(read);
  return { offset: Math.abs(t.center - i.center), trimmed: t.height < t.lineHeight };
}
