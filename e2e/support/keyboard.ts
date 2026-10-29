// Keyboard-only navigation helpers. Every helper reaches its target the way
// an author would: by pressing keys and checking where focus landed.

import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Presses Tab (or Shift+Tab) until `target` has focus. Fails with the list of
 * elements visited when it is not reached, so a broken tab order reads as one.
 */
export async function tabTo(
  page: Page,
  target: Locator,
  { max = 40, backwards = false }: { max?: number; backwards?: boolean } = {}
): Promise<void> {
  const visited: string[] = [];
  for (let i = 0; i < max; i++) {
    if (await isFocused(target)) return;
    await page.keyboard.press(backwards ? "Shift+Tab" : "Tab");
    visited.push(await describeFocus(page));
  }
  if (await isFocused(target)) return;
  throw new Error(`Tab never reached ${target}. Visited:\n  ${visited.join("\n  ")}`);
}

/**
 * Presses `key` (an arrow, usually) until `target` has focus: movement inside
 * a roving-focus group such as a toolbar, menu, grid or listbox.
 */
export async function pressUntilFocused(
  page: Page,
  key: string,
  target: Locator,
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

/** Whether focus is on `region` or inside it (a pane container or its content). */
export async function isFocusWithin(region: Locator): Promise<boolean> {
  return region.evaluate((el) => el.contains(document.activeElement)).catch(() => false);
}

/**
 * Presses Shift+Tab until focus leaves `frameElement` for the host page. A Frame
 * keeps keyboard focus while it is mounted, so a host Command (the palette) must
 * be reached from the host after the Frame has handed focus back.
 */
export async function leaveFrame(
  page: Page,
  frameElement: Locator,
  { max = 20 }: { max?: number } = {}
): Promise<void> {
  const visited: string[] = [];
  for (let i = 0; i < max; i++) {
    if (!(await isFrameFocused(frameElement))) return;
    await page.keyboard.press("Shift+Tab");
    visited.push(await describeFocus(page));
  }
  if (!(await isFrameFocused(frameElement))) return;
  throw new Error(`Shift+Tab never left the Frame. Visited:\n  ${visited.join("\n  ")}`);
}

/** Whether focus sits on the Frame element itself (inside its document). */
async function isFrameFocused(frameElement: Locator): Promise<boolean> {
  return frameElement.evaluate((el) => el === document.activeElement).catch(() => false);
}

/** Focus lands on `region` or inside it; retries like any expect. */
export async function expectFocusWithin(region: Locator): Promise<void> {
  await expect.poll(() => isFocusWithin(region), { message: `focus within ${region}` }).toBe(true);
}

async function isFocused(target: Locator): Promise<boolean> {
  return target.evaluate((el) => el === document.activeElement).catch(() => false);
}

/** Tag, role and accessible-ish name of the focused element, for failure messages. */
export async function describeFocus(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return "<body>";
    const name =
      el.getAttribute("aria-label") ??
      (el as HTMLInputElement).placeholder ??
      el.textContent?.trim().slice(0, 40) ??
      "";
    const role = el.getAttribute("role");
    return `${el.tagName.toLowerCase()}${role ? `[role=${role}]` : ""} "${name}"`;
  });
}

/**
 * Tab containment for a dialog (AC6): Tab and Shift+Tab from its focused
 * control, one full cycle past its last control, never leave it.
 */
export async function expectTabContained(page: Page, dialog: Locator): Promise<void> {
  const focusables = await dialog
    .locator(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    )
    .count();
  for (const key of ["Tab", "Shift+Tab"]) {
    for (let i = 0; i < focusables + 1; i++) {
      await page.keyboard.press(key);
      await expect(dialog.locator(":focus")).toHaveCount(1);
    }
  }
}

/** The text the keyboard selected, as the page reports it. */
export async function selectedText(page: Page): Promise<string> {
  return page.evaluate(() => document.getSelection()?.toString() ?? "");
}

/**
 * The text from the caret on to the end of its node in the focused editor, or
 * the selected text when a range is selected. A Plugin reveal lands a collapsed
 * caret on the echoed word, which `selectedText` would report as empty, and the
 * browser anchors that caret at the end of the text node before the decorated
 * word, so the text from the caret on is read from the next text node.
 */
export async function caretText(page: Page): Promise<string> {
  return page.evaluate(() => {
    function nextTextNode(node: Node): Text | null {
      const doc = node.ownerDocument;
      if (doc === null) return null;
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
      walker.currentNode = node;
      const next = walker.nextNode();
      return next instanceof Text ? next : null;
    }

    const selection = document.getSelection();
    if (selection === null || selection.rangeCount === 0) return "";
    if (!selection.isCollapsed) return selection.toString();
    const node = selection.anchorNode;
    if (node === null) return "";
    if (node.nodeType === Node.TEXT_NODE) {
      const data = (node as Text).data;
      if (selection.anchorOffset >= data.length) return nextTextNode(node)?.data ?? "";
      return data.slice(selection.anchorOffset);
    }
    // An element anchor's offset is a child index: the text from there on.
    const text = Array.from(node.childNodes)
      .slice(selection.anchorOffset)
      .map((child) => child.textContent ?? "")
      .join("");
    return text !== "" ? text : (nextTextNode(node)?.data ?? "");
  });
}
