// Plugin contributions (issue #437): a seeded tracer Plugin declares one of
// every surface. A sidebar entry opens its page (announced by the title), and
// a global Command it declares runs from its Shortcut and reaches the
// Plugin's Worker, whose notification proves the round trip. Keyboard only.
// @no-webkit: the seed needs OPFS, which the webkit project does not carry.

import type { Page } from "@playwright/test";
import { pressUntilFocused, tabTo } from "../support/keyboard";
import { expect, test } from "../support/test";

test.use({ plugins: ["tracer"] });

const primaryNav = (page: Page) => page.getByRole("listbox", { name: "Primary navigation" });
const navOption = (page: Page, name: string) =>
  primaryNav(page).getByRole("option", { name: new RegExp(`^${name}`) });
const toasts = (page: Page) => page.getByRole("status");

test.describe("Plugin contributions @wf:plugins-contributions @no-webkit", () => {
  test("the sidebar entry opens the Plugin page and announces its title", async ({ page }) => {
    await page.goto("/");
    // The Plugin is scanned after the first render; its entry appears then.
    await expect(navOption(page, "Tracer report")).toBeVisible({ timeout: 15_000 });

    // The navigation is one Tab stop; arrows move between its entries.
    await tabTo(page, navOption(page, "Books"));
    await pressUntilFocused(page, "ArrowDown", navOption(page, "Tracer report"), { max: 10 });
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/plugin\/tracer\/report$/);
    await expect(page.getByRole("heading", { name: "Tracer report", level: 1 })).toBeVisible();
    // The route announcer reads the page's heading, so the navigation is heard.
    await expect(toasts(page).filter({ hasText: "Tracer report" })).toBeVisible();
  });

  test("a global Plugin Command runs from its Shortcut and reaches the Plugin", async ({
    page,
  }) => {
    await page.goto("/");
    // The Plugin's Worker answered the health check (the tracer reports the
    // refused fetch once it is up); retry the Shortcut until it is ready.
    await expect(toasts(page).filter({ hasText: "tracer ready" })).toBeVisible({ timeout: 15_000 });

    await expect(async () => {
      await page.keyboard.press("ControlOrMeta+Alt+r");
      await expect(toasts(page).filter({ hasText: "tracer ran report" })).toBeVisible({
        timeout: 1_000,
      });
    }).toPass({ timeout: 15_000 });
  });
});
