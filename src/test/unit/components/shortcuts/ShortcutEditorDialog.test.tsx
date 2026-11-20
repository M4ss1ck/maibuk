// One part of the Shortcut Editor tests, split for #851: open, change, record, cancel, fixed key, conflicts.
// The support module registers the mocks, so it is imported first.
import {
  custom,
  expectFocusName,
  focusRow,
  openEditor,
  translate,
} from "@/test/support/shortcut-editor-dialog";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ShortcutEditorDialog } from "@/components/shortcuts/ShortcutEditorDialog";
import { useShortcutSettingsStore } from "@/features/settings/shortcut-store";

describe("Shortcut Editor", () => {
  it("does not build Command rows while closed and preserves the query on reopening", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const view = render(<ShortcutEditorDialog isOpen={false} onClose={onClose} />);
    translate.mockClear();

    view.rerender(<ShortcutEditorDialog isOpen={false} onClose={onClose} />);
    expect(translate).not.toHaveBeenCalledWith("shortcuts.syncNow");

    view.rerender(<ShortcutEditorDialog isOpen onClose={onClose} />);
    await user.type(screen.getByRole("searchbox"), "sync");
    expect(translate).toHaveBeenCalledWith("shortcuts.syncNow");

    translate.mockClear();
    view.rerender(<ShortcutEditorDialog isOpen={false} onClose={onClose} />);
    act(() => {
      useShortcutSettingsStore.getState().setCommandShortcuts("global.syncNow", [["Mod+Alt+y"]]);
    });
    expect(translate).not.toHaveBeenCalledWith("shortcuts.syncNow");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    view.rerender(<ShortcutEditorDialog isOpen onClose={onClose} />);
    expect(screen.getByRole("searchbox")).toHaveValue("sync");
    expect(screen.getByRole("dialog")).toHaveTextContent("CtrlAltY");
  });

  it("opens with focus inside, lists sections, and Escape closes it back to the opener", async () => {
    const { user, dialog } = await openEditor();
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(within(dialog).getByText("shortcuts.sections.common")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Open editor", { selector: "button" })).toHaveFocus();
  });

  it("changes a Shortcut with the keyboard only, and returns focus to Change", async () => {
    const { user } = await openEditor();
    await focusRow(user, "shortcuts.syncNow");
    await user.keyboard("{ArrowRight}");
    expectFocusName(/^shortcutEditor\.change/);

    await user.keyboard("{Enter}");
    const recorder = screen.getByRole("textbox", { name: /shortcutEditor\.recorder\.label/ });
    expect(recorder).toHaveFocus();

    await user.keyboard("{Control>}{Alt>}y{/Alt}{/Control}");
    expect(custom()["global.syncNow"]).toBeUndefined();
    await user.keyboard("{Enter}");

    expect(custom()["global.syncNow"]).toEqual([["Mod+Alt+y"]]);
    expectFocusName(/^shortcutEditor\.change/);
  });

  it("records a two-key sequence from Add", async () => {
    const { user } = await openEditor();
    await focusRow(user, "shortcuts.syncNow");
    // Change, Remove, then Add.
    await user.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}");
    expectFocusName(/^shortcutEditor\.add /);
    await user.keyboard("{Enter}");

    await user.keyboard("q");
    await user.keyboard("w");

    expect(custom()["global.syncNow"]).toEqual([["Mod+Shift+y"], ["q", "w"]]);
  });

  it("cancels on Escape without binding Escape or closing the dialog", async () => {
    const { user } = await openEditor();
    await focusRow(user, "shortcuts.syncNow");
    await user.keyboard("{ArrowRight}{Enter}");
    await user.keyboard("{Escape}");

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /recorder/ })).not.toBeInTheDocument();
    expect(custom()).toEqual({});
    expectFocusName(/^shortcutEditor\.change/);
  });

  it("cancels when Tab leaves the recorder, without recording Tab", async () => {
    const { user } = await openEditor();
    await focusRow(user, "shortcuts.syncNow");
    await user.keyboard("{ArrowRight}{Enter}");
    await user.tab();

    expect(screen.queryByRole("textbox", { name: /recorder/ })).not.toBeInTheDocument();
    expect(custom()).toEqual({});
  });

  it("blocks a Fixed key and keeps recording", async () => {
    const { user } = await openEditor();
    await focusRow(user, "shortcuts.syncNow");
    await user.keyboard("{ArrowRight}{Enter}");
    await user.keyboard("{Control>}z{/Control}{Enter}");

    const recorder = screen.getByRole("textbox", { name: /recorder/ });
    expect(recorder).toHaveFocus();
    expect(screen.getAllByText(/shortcutEditor\.errors\.locked/).length).toBeGreaterThan(0);
    expect(custom()).toEqual({});
  });

  it("asks before taking a key from another Command, and Replace moves only that key", async () => {
    const { user } = await openEditor();
    await focusRow(user, "shortcuts.syncNow");
    await user.keyboard("{ArrowRight}{Enter}");
    await user.keyboard("{Control>}s{/Control}{Enter}");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("shortcutEditor.conflict.message");
    expect(
      within(alert).getByRole("button", { name: "shortcutEditor.conflict.replace" })
    ).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(custom()["global.syncNow"]).toEqual([["Mod+s"]]);
    expect(custom()["common.save"]).toEqual([]);
  });

  it("Replace on a prefix conflict removes the longer sequences it shadows", async () => {
    const { user } = await openEditor();
    await focusRow(user, "shortcuts.syncNow");
    await user.keyboard("{ArrowRight}{Enter}");
    await user.keyboard("g{Enter}");

    const alert = await screen.findByRole("alert");
    expect(
      within(alert).getByRole("button", { name: "shortcutEditor.conflict.replace" })
    ).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(custom()["global.syncNow"]).toEqual([["g"]]);
    // The conflict is the other Command's own sequence, not the recorded key.
    expect(custom()["global.gotoProjects"]).toEqual([]);
    expect(custom()["global.gotoNotes"]).toEqual([]);
    expect(custom()["editor.bold"]).toBeUndefined();
  });
});
