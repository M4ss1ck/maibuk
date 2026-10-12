// Host-rendered Plugin UI (issue #438): a Plugin page draws the tree its
// Worker sends through Remote DOM. No fixture Plugin renders one yet, so this
// stays an expected failure citing the fixture/sandbox lane (issue #446);
// Vitest renders every kit component through the real remote renderer today
// (src/test/unit/plugins/plugin-ui-renderer.test.tsx).
// @no-webkit: the seed needs OPFS, which the webkit project does not carry.

import type { Page } from "@playwright/test";
import { pressUntilFocused, tabTo } from "../support/keyboard";
import { expect, test } from "../support/test";

const navOption = (page: Page, name: string) =>
  page.getByRole("listbox", { name: "Primary navigation" }).getByRole("option", {
    name: new RegExp(`^${name}`),
  });

test.describe("Host-rendered Plugin UI @wf:plugins-remote-ui @no-webkit", () => {
  test.use({ plugins: ["tracer"] });

  test.fail(
    "a Plugin page renders its Worker's tree and drives a control from the keyboard",
    {
      annotation: {
        type: "issue",
        description: "https://github.com/M4ss1ck/maibuk/issues/446",
      },
    },
    async ({ page }) => {
      await page.goto("/");
      await expect(navOption(page, "Tracer report")).toBeVisible({ timeout: 15_000 });

      // Open the Plugin's page the way an author reaches it (Tab, ArrowDown, Enter).
      await tabTo(page, navOption(page, "Books"));
      await pressUntilFocused(page, "ArrowDown", navOption(page, "Tracer report"), { max: 10 });
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/plugin\/tracer\/report$/);
      await expect(page.getByRole("heading", { name: "Tracer report", level: 1 })).toBeVisible();

      // The controls the Plugin declares; no fixture sends them yet.
      const field = page.getByRole("textbox", { name: "Search" });
      await expect(field).toBeVisible();
      await tabTo(page, field);
      await page.keyboard.type("echo");
      await expect(field).toHaveValue("echo");
    }
  );
});
