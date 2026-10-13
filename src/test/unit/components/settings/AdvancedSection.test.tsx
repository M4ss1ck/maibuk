/**
 * Reset settings in Settings → Advanced (#442, plan decision 7): an
 * alertdialog opened by keyboard, Escape cancels with nothing reset, and
 * confirming clears settings, Custom Shortcuts, and approvals while leaving the
 * Plugin Directory and the Library alone.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import i18n from "@/i18n";
import "@/i18n";

vi.mock("@/lib/db", () => ({
  getDatabase: vi.fn().mockResolvedValue({}),
  exportDatabase: vi.fn().mockResolvedValue(new Uint8Array()),
  importDatabase: vi.fn().mockResolvedValue(undefined),
  resetDatabase: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/features/backup/backup-service", () => ({
  BackupService: vi.fn(() => ({ createBackup: vi.fn().mockResolvedValue(undefined) })),
}));

vi.mock("@/features/sync/pending-edits", () => ({
  flushPendingEdits: vi.fn().mockResolvedValue(undefined),
}));

const { AdvancedSection } = await import("@/components/settings/AdvancedSection");
const { ToastViewport } = await import("@/components/ui/Toast");
const { useModalStore } = await import("@/components/ui/modal-store");
const { PLUGIN_APPROVALS_STORAGE_KEY, listPluginApprovals, savePluginApproval } = await import(
  "@/features/plugins/approvals"
);
const { registerPluginSecretStore } = await import("@/features/plugins/secret-store");
const { usePluginManagementStore } = await import("@/features/plugins/management");
const { useSettingsRevealStore } = await import("@/features/settings/settings-reveal-store");
const { useSettingsStore } = await import("@/features/settings/store");
const { useShortcutSettingsStore } = await import("@/features/settings/shortcut-store");
const { resetDatabase } = await import("@/lib/db");

type User = ReturnType<typeof userEvent.setup>;

/** Tabs until `target` has focus, then asserts it. */
async function tabTo(user: User, target: HTMLElement, max = 14): Promise<void> {
  for (let i = 0; i < max; i++) {
    if (document.activeElement === target) return;
    await user.tab();
  }
  expect(document.activeElement).toBe(target);
}

async function openResetSettingsDialog(user: User): Promise<HTMLElement> {
  await tabTo(user, screen.getByRole("button", { name: "Advanced" }));
  await user.keyboard("{Enter}");
  const trigger = screen.getByRole("button", { name: "Reset settings" });
  await tabTo(user, trigger);
  await user.keyboard("{Enter}");
  await screen.findByRole("alertdialog");
  return trigger;
}

let refresh: Mock<() => Promise<void>>;

beforeEach(() => {
  localStorage.clear();
  vi.mocked(resetDatabase).mockClear();
  useModalStore.setState({ modalIds: [], openCount: 0, closers: {} });
  useSettingsRevealStore.setState({ advancedOpen: false });
  useSettingsStore.setState({ appFontSize: 20, pluginDevelopmentMode: true, language: "en" });
  useShortcutSettingsStore.setState((state) => ({
    shortcuts: { ...state.shortcuts, custom: {}, voice: {} },
  }));
  useShortcutSettingsStore.getState().setCommandShortcuts("common.save", [["Mod+k"]]);
  savePluginApproval({
    pluginId: "echoes",
    pinnedHash: "h1:x",
    granted: [],
    enabled: true,
    approvedVersion: "1.0.0",
    approvedPermissions: { required: [], optional: [] },
    approvedFiles: {},
  });
  refresh = vi.fn(async () => {});
  usePluginManagementStore.setState({ refresh, plugins: {}, notifications: [] });
});

afterEach(async () => {
  registerPluginSecretStore(null);
  localStorage.removeItem(PLUGIN_APPROVALS_STORAGE_KEY);
  await i18n.changeLanguage("en");
});

describe("AdvancedSection Reset settings", () => {
  it("opens by keyboard, cancels on Escape with nothing reset, and resets on confirm", async () => {
    const user = userEvent.setup();
    render(<AdvancedSection />);

    const trigger = await openResetSettingsDialog(user);
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Reset all settings?")).toBeInTheDocument();
    expect(within(dialog).getByText(/Saved credentials are deleted\./)).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Reset settings and delete credentials" })
    ).toBeInTheDocument();

    // Escape cancels: nothing is reset and focus returns to the trigger.
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(refresh).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().appFontSize).toBe(20);
    expect(useSettingsStore.getState().pluginDevelopmentMode).toBe(true);
    expect(useShortcutSettingsStore.getState().shortcuts.custom["common.save"]).toEqual([
      ["Mod+k"],
    ]);
    expect(listPluginApprovals()).toHaveLength(1);
    expect(resetDatabase).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);

    // Confirm resets everything the action owns.
    await tabTo(user, trigger);
    await user.keyboard("{Enter}");
    const confirm = within(await screen.findByRole("alertdialog")).getByRole("button", {
      name: "Reset settings and delete credentials",
    });
    await tabTo(user, confirm);
    await user.keyboard("{Enter}");

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(useSettingsStore.getState().appFontSize).toBe(16);
    expect(useSettingsStore.getState().pluginDevelopmentMode).toBe(false);
    expect(useShortcutSettingsStore.getState().shortcuts.custom).toEqual({});
    expect(listPluginApprovals()).toHaveLength(0);
    // The Library is never reset by Reset settings.
    expect(resetDatabase).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("shows an error toast when deleting credentials fails, after resetting everything else", async () => {
    registerPluginSecretStore({
      clearAll: async () => {
        throw new Error("keychain locked");
      },
    });
    const user = userEvent.setup();
    render(
      <>
        <AdvancedSection />
        <ToastViewport />
      </>
    );

    await openResetSettingsDialog(user);
    const confirm = within(screen.getByRole("alertdialog")).getByRole("button", {
      name: "Reset settings and delete credentials",
    });
    await tabTo(user, confirm);
    await user.keyboard("{Enter}");

    // The UI reports the failure…
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/could not be deleted/i);
    // …and every other step still ran.
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(useSettingsStore.getState().appFontSize).toBe(16);
    expect(useShortcutSettingsStore.getState().shortcuts.custom).toEqual({});
    expect(listPluginApprovals()).toHaveLength(0);
  });
});
