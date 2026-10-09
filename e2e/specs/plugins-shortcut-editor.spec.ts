// Plugin Commands in the Shortcut Editor: the Plugins section and the
// Inactive badge. No Plugin can load in the app until the fixture Plugins
// land (issue #446), so this stays an expected failure citing that issue;
// Vitest proves the same surface today (ShortcutEditorDialog.test.tsx).

import { tabTo } from "../support/keyboard";
import { expect, test } from "../support/test";

test.describe("Plugin Commands in the Shortcut Editor @wf:plugins-shortcut-editor", () => {
  test.fail(
    "a conflicting Plugin Default Shortcut and Voice phrase show as inactive",
    {
      annotation: {
        type: "issue",
        description: "https://github.com/M4ss1ck/maibuk/issues/446",
      },
    },
    async ({ page }) => {
      await page.goto("/settings");
      await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();

      // Open the editor the way an author does. Everything up to the Plugin
      // row must succeed; only the absent row and badge may fail.
      const open = page.getByRole("button", { name: "Customize shortcuts" });
      await tabTo(page, open, { max: 90 });
      await page.keyboard.press("Enter");
      const editor = page.getByRole("dialog", { name: "Customize shortcuts" });
      await expect(editor).toBeVisible();

      await tabTo(page, editor.getByRole("searchbox"));
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.type("Show report");
      await expect(editor.getByRole("row", { name: "Show report", exact: true })).toBeVisible();
      await expect(editor.getByText("Inactive").first()).toBeVisible();
    }
  );
});
