// Plugin Commands in the Shortcut Editor: the Plugins section and the
// Inactive badge. No Plugin can load in the app until the fixture Plugins
// land (issue #446), so this stays an expected failure citing that issue;
// Vitest proves the same surface today (ShortcutEditorDialog.test.tsx).

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

      // No Plugin registers in this build, so the row cannot exist yet.
      const editor = page.getByRole("dialog", { name: "Customize shortcuts" });
      await expect(editor.getByRole("row", { name: "Show report" })).toBeVisible();
      await expect(editor.getByText("Inactive").first()).toBeVisible();
    }
  );
});
