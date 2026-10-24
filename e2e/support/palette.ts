// Running a Command from the Command Palette by keyboard. The palette ranks
// results off a deferred query, so a key pressed inside that window acts on
// the row the author still sees (#552), and React Aria moves the input's
// aria-activedescendant a beat after typing. An option being visible is not
// enough: while `>Hostile Tauri IPC` is still ranked as `>Hostile`, its row is
// already listed but another row is active, and Enter runs that one (#646).
// These helpers press Enter only once the wanted row is the active result.

import type { Locator, Page } from "@playwright/test";
import { expect } from "./test";

/** The open Command Palette, by its localized name. */
export function paletteDialog(page: Page, name = "Command palette"): Locator {
  return page.getByRole("dialog", { name });
}

/**
 * Types `>label` into the open palette and waits until the option named
 * exactly `label` is the active result, so Enter runs it. Returns the option.
 * `timeout` bounds the wait for the option to be listed, for a Command whose
 * Plugin may still be starting.
 */
export async function selectPaletteCommand(
  page: Page,
  dialog: Locator,
  label: string,
  options: { timeout?: number } = {}
): Promise<Locator> {
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(`>${label}`);
  const option = dialog.getByRole("option", { name: label, exact: true });
  await expect(option).toBeVisible({ timeout: options.timeout });
  const id = await option.getAttribute("id");
  expect(id, `the "${label}" option has no id to be the active descendant`).toBeTruthy();
  await expect(dialog.getByRole("searchbox")).toHaveAttribute("aria-activedescendant", id!);
  return option;
}

/** Opens the palette with F1, runs the Command named `label`, and waits for it to close. */
export async function runPaletteCommand(
  page: Page,
  label: string,
  options: { dialogName?: string } = {}
): Promise<void> {
  await page.keyboard.press("F1");
  const dialog = paletteDialog(page, options.dialogName);
  await expect(dialog).toBeVisible();
  await selectPaletteCommand(page, dialog, label);
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
}
