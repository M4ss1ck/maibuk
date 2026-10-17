// Echoes' Palette dropdown in Settings (#533): the dropdown is disabled while
// "Color highlights by echo" is off, a keyboard choice of a Palette is stored
// Library-wide and survives a reload, and the open dropdown names each Palette
// by its text ("Vivid, 8 colors") with its swatches as decoration.

import { tabTo } from "../support/keyboard";
import { expect, test } from "../support/test";

test.use({
  library: "echoesBook",
  plugins: ["maibuk-echoes"],
  pluginApprovals: [
    {
      pluginId: "maibuk-echoes",
      granted: ["library:read", "editor:read", "editor:decorate"],
    },
  ],
  builtInPlugins: [{ id: "maibuk-echoes" }],
});

const SETTINGS_ROW = '[data-settings-row="plugin.maibuk-echoes.detection"]';

test.describe("Echoes Palette @wf:plugins-echoes-palette", () => {
  test("the Palette dropdown waits for coloring, then a keyboard choice persists", async ({
    page,
  }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
    const accordion = page.getByRole("button", { name: "Echoes" });
    await expect(accordion).toBeVisible({ timeout: 20_000 });
    await tabTo(page, accordion, { max: 250 });
    await page.keyboard.press("Enter");

    const row = page.locator(SETTINGS_ROW);
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.scrollIntoViewIfNeeded();

    const palette = page.getByRole("button", { name: /Palette/ });
    await expect(palette).toBeDisabled();

    const color = page.getByRole("switch", { name: "Color highlights by echo" });
    await tabTo(page, color);
    await page.keyboard.press("Space");
    await expect(color).toBeChecked();
    await expect(palette).toBeEnabled();

    await tabTo(page, palette);
    await page.keyboard.press("Enter");
    const listbox = page.getByRole("listbox");
    await expect(listbox.getByRole("option", { name: "Okabe-Ito, 8 colors" })).toBeVisible();
    await expect(listbox.getByRole("option", { name: "Soft, 8 colors" })).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(palette).toHaveText(/Vivid, 8 colors/);

    await page.reload();
    await page.goto("/settings");
    const reopened = page.getByRole("button", { name: "Echoes" });
    await expect(reopened).toBeVisible({ timeout: 20_000 });
    await tabTo(page, reopened, { max: 250 });
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: /Palette/ })).toHaveText(/Vivid, 8 colors/, {
      timeout: 20_000,
    });
  });
});
