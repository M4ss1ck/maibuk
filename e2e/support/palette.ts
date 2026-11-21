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
  await expectActiveOption(dialog, option);
  return option;
}

/** Waits until `option` is the palette's active result, the row Enter acts on. */
export async function expectActiveOption(dialog: Locator, option: Locator): Promise<void> {
  const id = await option.getAttribute("id");
  expect(id, "the option has no id to be the active descendant").toBeTruthy();
  await expect(dialog.getByRole("searchbox")).toHaveAttribute("aria-activedescendant", id!);
}

/**
 * Arrows until `option` is the palette's active result in Library Search.
 * There the Library and text rows arrive after the keystrokes, and a later
 * deferred list can drop the active row so that none is active; waiting
 * alone can then wait forever. Commands mode settles from the query alone:
 * use `expectActiveOption` there.
 */
export async function arrowToOption(page: Page, dialog: Locator, option: Locator): Promise<void> {
  const key = await option.getAttribute("data-key");
  expect(key, "the option has no data-key to arrow to").toBeTruthy();
  await arrowToKey(page, dialog, key!);
}

/**
 * Arrows until the item with key `key` (e.g. `command:global.toggleTheme`) is
 * the palette's active result. Each poll re-reads the list, so a row that
 * lands mid-walk or a press swallowed while the list settles only costs one
 * more press. With both rows rendered it steps toward the target; with the
 * target outside the virtualized window it walks down, and turns once two
 * presses leave the active row where it was (an end: the arrows do not wrap).
 * The key matches whole: `settingsRow:spellCheck` never stops on
 * `settingsRow:spellCheckDictionaries`.
 */
export async function arrowToKey(
  page: Page,
  dialog: Locator,
  key: string,
  { max = 30 } = {}
): Promise<void> {
  const searchbox = dialog.getByRole("searchbox");
  let arrow: "ArrowDown" | "ArrowUp" = "ArrowDown";
  let previous: string | null | undefined;
  let unmoved = 0;
  let presses = 0;
  await expect
    .poll(
      async () => {
        const active = (await searchbox.getAttribute("aria-activedescendant")) ?? "";
        const keys = await dialog
          .getByRole("option")
          .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-key")));
        const activeKey = active ? (keyOfOptionId(active, keys) ?? null) : null;
        if (activeKey === key || presses >= max) return activeKey;
        const target = keys.indexOf(key);
        if (activeKey === null) {
          // No active row: ArrowDown lands on the first.
          arrow = "ArrowDown";
        } else if (target >= 0) {
          arrow = keys.indexOf(activeKey) < target ? "ArrowDown" : "ArrowUp";
        } else {
          unmoved = activeKey === previous ? unmoved + 1 : 0;
          if (unmoved >= 2) {
            arrow = arrow === "ArrowDown" ? "ArrowUp" : "ArrowDown";
            unmoved = 0;
          }
        }
        previous = activeKey;
        presses++;
        await page.keyboard.press(arrow);
        return activeKey;
      },
      // One read per press: a second per press bounds the walk.
      { message: `arrow to the ${key} row`, intervals: [100], timeout: max * 1_000 }
    )
    .toBe(key);
}

/** The listed key whose option id `active` names (`<listbox id>-option-<key>`). */
function keyOfOptionId(active: string, keys: readonly (string | null)[]): string | undefined {
  return keys.find((key): key is string => key !== null && active.endsWith(`-option-${key}`));
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
