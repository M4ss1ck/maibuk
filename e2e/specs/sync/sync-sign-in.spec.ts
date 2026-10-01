import { expectFocusWithin, expectTabContained, tabTo } from "../../support/keyboard";
import {
  authDialog,
  expect,
  fillAuthDialog,
  loginButton,
  openSettings,
  signIn,
  syncSection,
  test,
} from "../../support/sync";

// Sign in to a Sync Account on the run's PocketBase, by keyboard (issue #222).

test.describe("Sign in to a Sync Account @wf:sync-sign-in", () => {
  test("Log In with server URL, email and password signs in; the dialog keeps focus inside", async ({
    page,
    syncUrl,
    account,
  }) => {
    await openSettings(page);
    await expect(syncSection(page).getByText("Not logged in")).toBeVisible();
    await tabTo(page, loginButton(page), { max: 80 });
    await page.keyboard.press("Enter");

    const dialog = authDialog(page);
    await expect(dialog).toBeVisible();
    await expectFocusWithin(dialog);
    await expectTabContained(page, dialog);

    await fillAuthDialog(page, syncUrl, account);
    await expect(dialog).toBeHidden();
    await expect(syncSection(page).getByText(`Logged in as ${account.email}`)).toBeVisible();
    await expect(syncSection(page).getByRole("switch", { name: "Sync automatically" })).toBeVisible();
  });

  test("A wrong password shows the server's error and keeps the dialog open", async ({
    page,
    syncUrl,
    account,
  }) => {
    await openSettings(page);
    await tabTo(page, loginButton(page), { max: 80 });
    await page.keyboard.press("Enter");
    await fillAuthDialog(page, syncUrl, { email: account.email, password: "not-the-password" });

    const dialog = authDialog(page);
    await expect(dialog.getByText("Failed to authenticate.")).toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(syncSection(page).getByText("Not logged in")).toBeVisible();
  });

  test("Sign up creates a new Sync Account and signs in", async ({ page, syncUrl }) => {
    const fresh = {
      email: `signup-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@maibuk.test`,
      password: `pw-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`,
    };
    await openSettings(page);
    await tabTo(page, loginButton(page), { max: 80 });
    await page.keyboard.press("Enter");
    await tabTo(page, authDialog(page).getByRole("button", { name: "Don't have an account? Sign up" }), {
      max: 10,
    });
    await page.keyboard.press("Enter");
    await fillAuthDialog(page, syncUrl, fresh, "Sign Up");
    await expect(authDialog(page, "Sign Up")).toBeHidden();
    await expect(syncSection(page).getByText(`Logged in as ${fresh.email}`)).toBeVisible();
  });

  test("Escape closes the dialog and focus returns to Log In", async ({ page }) => {
    await openSettings(page);
    await tabTo(page, loginButton(page), { max: 80 });
    await page.keyboard.press("Enter");
    await expect(authDialog(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(authDialog(page)).toBeHidden();
    await expect(loginButton(page)).toBeFocused();
  });

  test("Log Out returns to Not logged in", async ({ page, syncUrl, account }) => {
    await signIn(page, syncUrl, account);
    await tabTo(page, syncSection(page).getByRole("button", { name: "Log Out" }), { max: 20 });
    await page.keyboard.press("Enter");
    await expect(syncSection(page).getByText("Not logged in")).toBeVisible();
    await expect(loginButton(page)).toBeVisible();
  });

  test("Settings' Server URL shows the URL signed in with, and tabbing past it keeps it", async ({
    page,
    syncUrl,
    account,
  }) => {
    await signIn(page, syncUrl, account);
    const field = syncSection(page).getByRole("textbox", { name: "Server URL" });
    await expect(field).toHaveValue(syncUrl);
    await tabTo(page, field, { max: 40, backwards: true });
    await page.keyboard.press("Tab");
    await page.reload();
    await expect(syncSection(page).getByRole("textbox", { name: "Server URL" })).toHaveValue(syncUrl);
    await expect(syncSection(page).getByText(`Logged in as ${account.email}`)).toBeVisible();
  });
});
