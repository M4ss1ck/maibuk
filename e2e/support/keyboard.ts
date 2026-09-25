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
