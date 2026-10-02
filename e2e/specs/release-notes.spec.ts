// What's new: the Release badge opens the Release Notes, from the sidebar,
// from Settings → About, and from the Command Palette. Keyboard only. The web
// build never checks for newer Releases, so the New chip and the Download
// footer are covered by Vitest (ReleaseNotesDialog.test.tsx).

import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { capture } from "../support/capture";
import { expectTabContained, tabTo } from "../support/keyboard";
import { expect, test } from "../support/test";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  version: string;
};
const RELEASE = `v${pkg.version}`;

const badge = (page: Page) =>
  page.getByRole("button", { name: `Maibuk ${RELEASE}, What's new`, exact: true });
const dialog = (page: Page) => page.getByRole("dialog", { name: "What's new" });
const notes = (page: Page) => dialog(page).getByRole("region", { name: "Release Notes" });

async function expectNotesOpen(page: Page): Promise<void> {
  await expect(dialog(page)).toBeVisible();
  await expect(notes(page)).toBeFocused();
  await expect(notes(page).getByRole("heading", { level: 3 }).first()).toHaveText(pkg.version);
  await expect(dialog(page).getByRole("button", { name: /^Download/ })).toHaveCount(0);
}

test.describe("Release Notes @wf:shell-release-notes", () => {
  test("Sidebar badge: Enter opens, Escape returns focus to the badge", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "My Books", level: 1 })).toBeVisible();

    await tabTo(page, badge(page).first(), { max: 30 });
    await page.keyboard.press("Enter");
    await expectNotesOpen(page);
    await expect(notes(page).getByRole("heading", { name: "Added", level: 4 }).first()).toBeVisible();
    await capture(page, "release-notes");

    await expectTabContained(page, dialog(page));
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeHidden();
    await expect(badge(page).first()).toBeFocused();
  });

  test("Settings → About badge opens the same dialog", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();

    const aboutBadge = page.locator('[data-settings-row="appVersion"]').getByRole("button", {
      name: `Maibuk ${RELEASE}, What's new`,
    });
    // About is the last section; only the outline comes after it.
    await tabTo(page, aboutBadge, { backwards: true, max: 12 });
    await capture(page, "release-badge-about", { around: [aboutBadge] });
    await page.keyboard.press("Enter");
    await expectNotesOpen(page);

    await page.keyboard.press("Escape");
    await expect(aboutBadge).toBeFocused();
  });

  test("Command Palette: Show what's new @sc:global.openReleaseNotes", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "My Books", level: 1 })).toBeVisible();

    await page.keyboard.press("F1");
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await expect(palette).toBeVisible();
    await page.keyboard.type("what's new");
    await expect(palette.getByRole("option", { name: /Show what's new/ }).first()).toBeVisible();
    await page.keyboard.press("Enter");

    await expect(palette).toBeHidden();
    await expectNotesOpen(page);
  });
});
