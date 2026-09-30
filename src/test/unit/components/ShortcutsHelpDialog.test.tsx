import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShortcutsHelpDialog } from "@/components/ShortcutsHelpDialog";
import { useModalStore } from "@/components/ui/modal-store";
import { useDictationStore } from "@/features/dictation/store";
import { useBoundShortcutIds } from "@/lib/bound-shortcuts";
import { useShortcutSettingsStore } from "@/features/settings/shortcut-store";
import { DEFAULT_SHORTCUT_SETTINGS } from "@/lib/shortcut-resolve";
import type { CommandId } from "@/lib/shortcut-registry";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/lib/platform", () => ({ isMac: () => false, IS_ANDROID: false }));

function Screen({ bound, onCustomize }: { bound: CommandId[]; onCustomize?: () => void }) {
  useBoundShortcutIds(bound);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Show shortcuts
      </button>
      <ShortcutsHelpDialog isOpen={open} onClose={() => setOpen(false)} onCustomize={onCustomize} />
    </>
  );
}

async function openHelp(bound: CommandId[], onCustomize?: () => void) {
  const user = userEvent.setup();
  render(<Screen bound={bound} onCustomize={onCustomize} />);
  await user.tab();
  expect(screen.getByRole("button", { name: "Show shortcuts" })).toHaveFocus();
  await user.keyboard("{Enter}");
  return { user, dialog: await screen.findByRole("dialog") };
}

describe("ShortcutsHelpDialog", () => {
  beforeEach(() => {
    useModalStore.setState({ modalIds: [], openCount: 0, closers: {} });
    useShortcutSettingsStore.setState({ shortcuts: structuredClone(DEFAULT_SHORTCUT_SETTINGS) });
    useDictationStore.setState({ enabled: false, languageOverride: null });
  });

  it("lists what works on this screen first, then the rest by section", async () => {
    const { dialog } = await openHelp(["global.showHelp", "common.save"]);

    const thisScreen = within(dialog).getByRole("region", { name: "shortcuts.onThisScreen" });
    const everywhere = within(thisScreen).getByRole("region", {
      name: "shortcuts.sections.global",
    });
    expect(within(everywhere).getByText("shortcuts.showHelp")).toBeInTheDocument();
    const common = within(thisScreen).getByRole("region", { name: "shortcuts.sections.common" });
    expect(within(common).getByText("shortcuts.save")).toBeInTheDocument();
    expect(within(thisScreen).queryByText("shortcuts.newBook")).not.toBeInTheDocument();

    const otherScreens = within(dialog).getByRole("region", { name: "shortcuts.onOtherScreens" });
    const books = within(otherScreens).getByRole("region", { name: "shortcuts.sections.bookList" });
    expect(within(books).getByText("shortcuts.newBook")).toBeInTheDocument();
    const bookEditor = within(otherScreens).getByRole("region", {
      name: "shortcuts.sections.bookEditor",
    });
    expect(within(bookEditor).getByText("shortcuts.saveVersion")).toBeInTheDocument();
    // Bound here, so not repeated under other screens.
    expect(within(otherScreens).queryByText("shortcuts.save")).not.toBeInTheDocument();
  });

  it("never lists an unbound global shortcut as belonging to another screen", async () => {
    const { dialog } = await openHelp(["global.showHelp"]);

    const otherScreens = within(dialog).getByRole("region", { name: "shortcuts.onOtherScreens" });
    expect(within(otherScreens).queryByText("shortcuts.toggleAlwaysOnTop")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("shortcuts.toggleAlwaysOnTop")).not.toBeInTheDocument();
  });

  it("says so when nothing is bound on this screen", async () => {
    const { dialog } = await openHelp([]);

    const thisScreen = within(dialog).getByRole("region", { name: "shortcuts.onThisScreen" });
    expect(within(thisScreen).getByText("shortcuts.none")).toBeInTheDocument();
  });

  it("lists the Focus section last with its voice-runnable keys", async () => {
    const { dialog } = await openHelp(["global.showHelp", "focus.next", "focus.previous"]);

    const thisScreen = within(dialog).getByRole("region", { name: "shortcuts.onThisScreen" });
    const focus = within(thisScreen).getByRole("region", {
      name: "shortcuts.sections.focus",
    });
    expect(within(focus).getByText("shortcuts.focus.next")).toBeInTheDocument();
    expect(within(focus).getByText("shortcuts.focus.previous")).toBeInTheDocument();
    const sections = within(thisScreen).getAllByRole("region");
    expect(sections[sections.length - 1]).toBe(focus);
  });

  it("closes with Escape and returns focus to the button that opened it", async () => {
    const { user } = await openHelp(["global.showHelp"]);

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show shortcuts" })).toHaveFocus();
  });

  it("opens Customize with Enter", async () => {
    const onCustomize = vi.fn();
    const { user, dialog } = await openHelp(["global.showHelp"], onCustomize);
    const button = within(dialog).getByRole("button", { name: "shortcuts.customize" });
    button.focus();
    await user.keyboard("{Enter}");
    expect(onCustomize).toHaveBeenCalledOnce();
  });

  it("omits a bound Command after the author sets No shortcut", async () => {
    useShortcutSettingsStore.getState().setCommandShortcuts("global.showHelp", []);
    const { dialog } = await openHelp(["global.showHelp"]);
    const thisScreen = within(dialog).getByRole("region", { name: "shortcuts.onThisScreen" });
    expect(within(thisScreen).queryByText("shortcuts.showHelp")).not.toBeInTheDocument();
    expect(within(thisScreen).getByText("shortcuts.none")).toBeInTheDocument();
  });

  it("shows no voice phrases when Dictation is off", async () => {
    useDictationStore.setState({ enabled: false });
    const { dialog } = await openHelp(["global.showHelp", "global.gotoNotes"]);

    expect(within(dialog).queryByText("Go to Notes")).not.toBeInTheDocument();
    expect(
      within(dialog).queryByText("shortcutEditor.voice.rowLabel")
    ).not.toBeInTheDocument();
  });

  it("shows the derived phrase when Dictation is on", async () => {
    useDictationStore.setState({ enabled: true, languageOverride: null });
    const { dialog } = await openHelp(["global.showHelp", "global.gotoNotes"]);

    expect(within(dialog).getByText("Go to Notes")).toBeInTheDocument();
  });

  it("shows the custom phrase instead of the default", async () => {
    useDictationStore.setState({ enabled: true, languageOverride: null });
    useShortcutSettingsStore.getState().setCommandVoicePhrases("global.gotoNotes", "en", [
      "open notes list",
    ]);
    const { dialog } = await openHelp(["global.showHelp", "global.gotoNotes"]);

    expect(within(dialog).getByText("open notes list")).toBeInTheDocument();
    expect(within(dialog).queryByText("Go to Notes")).not.toBeInTheDocument();
  });

  it("shows the Spanish phrase for the Spanish Dictation Language", async () => {
    useDictationStore.setState({ enabled: true, languageOverride: "es" });
    const { dialog } = await openHelp(["global.showHelp", "global.gotoNotes"]);

    expect(within(dialog).getByText("Ir a Notas")).toBeInTheDocument();
    expect(within(dialog).queryByText("Go to Notes")).not.toBeInTheDocument();
  });
});
