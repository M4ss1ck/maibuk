// One part of the Shortcut Editor tests, split for #851: search switches, remove and reset, single-key, filters, Shortcut File.
// The support module registers the mocks, so it is imported first.
import {
  custom,
  expectFocusName,
  file,
  filterButton,
  findDialogTitled,
  focusRow,
  narrowList,
  openEditor,
} from "@/test/support/shortcut-editor-dialog";
import { act, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useShortcutSettingsStore } from "@/features/settings/shortcut-store";
import { serializeShortcutFile } from "@/lib/shortcut-resolve";

describe("Shortcut Editor", () => {
  it("lists the three search switches as Commands with their Default Shortcuts", async () => {
    const { user } = await openEditor();
    await narrowList(user, "editor.matchCase");

    const grid = screen.getByRole("grid");
    expect(within(grid).getByText("editor.matchCase")).toBeInTheDocument();
    // The Default Shortcut is Alt+C on this (non-Mac) platform.
    expect(grid.textContent ?? "").toContain("Alt");
    expect(grid.textContent ?? "").toContain("C");

    await user.clear(screen.getByRole("searchbox"));
    await user.paste("editor.matchWholeWord");
    expect(within(screen.getByRole("grid")).getByText("editor.matchWholeWord")).toBeInTheDocument();

    await user.clear(screen.getByRole("searchbox"));
    await user.paste("editor.useRegex");
    expect(within(screen.getByRole("grid")).getByText("editor.useRegex")).toBeInTheDocument();
  });

  it("changes one search switch's Shortcut like any other Command", async () => {
    const { user } = await openEditor();
    await focusRow(user, "editor.matchCase");
    await user.keyboard("{ArrowRight}{Enter}");
    await user.keyboard("{Control>}{Alt>}k{/Alt}{/Control}{Enter}");

    expect(custom()["common.matchCase"]).toEqual([["Mod+Alt+k"]]);
  });

  it("removes and resets a Command's Shortcuts", async () => {
    const { user } = await openEditor();
    await focusRow(user, "shortcuts.syncNow");
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expectFocusName(/^shortcutEditor\.remove/);
    await user.keyboard("{Enter}");
    expect(custom()["global.syncNow"]).toEqual([]);
    expect(screen.getByRole("status")).toHaveTextContent("shortcutEditor.announce.removed");

    expectFocusName(/^shortcutEditor\.add /);
    await user.keyboard("{ArrowRight}");
    expectFocusName(/^shortcutEditor\.reset /);
    await user.keyboard("{Enter}");
    expect(custom()["global.syncNow"]).toBeUndefined();
  });

  it("resets everything after confirming in an alert dialog", async () => {
    useShortcutSettingsStore.setState({
      shortcuts: {
        version: 2,
        voice: {},
        custom: { "global.syncNow": [], "editor.bold": [["Mod+Shift+k"]] },
        singleKeyEnabled: true,
      },
    });
    const { user } = await openEditor();
    await narrowList(user, "shortcuts.syncNow");
    const resetAll = screen.getByText("shortcutEditor.resetAll", { selector: "button" });
    await act(async () => resetAll.focus());
    await user.keyboard("{Enter}");

    const confirm = await findDialogTitled("shortcutEditor.resetAllTitle");
    await user.keyboard("{Escape}");
    expect(confirm).not.toBeInTheDocument();
    expect(Object.keys(custom())).toHaveLength(2);

    await user.keyboard("{Enter}");
    await findDialogTitled("shortcutEditor.resetAllTitle");
    // Focus starts on the close button; the confirm button is last in the footer.
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(document.activeElement).toHaveTextContent("shortcutEditor.resetAll");
    await user.keyboard("{Enter}");
    expect(custom()).toEqual({});
    // Nothing is left to reset, so Reset all is disabled and cannot take focus
    // back; it lands on search instead of falling to <body>.
    expect(resetAll).toBeDisabled();
    expect(screen.getByRole("searchbox")).toHaveFocus();
  });

  it("turns single-key Shortcuts off from the switch", async () => {
    const { user } = await openEditor();
    const toggle = screen.getByRole("switch", { name: "shortcutEditor.singleKey" });
    // Sighted authors see the same name beside the switch.
    expect(
      screen.getByText("shortcutEditor.singleKey", { selector: "span[aria-hidden]" })
    ).not.toHaveClass("sr-only");
    await act(async () => toggle.focus());
    await user.keyboard(" ");
    expect(useShortcutSettingsStore.getState().shortcuts.singleKeyEnabled).toBe(false);
  });

  it("filters to customized Commands and finds Commands by their keys", async () => {
    useShortcutSettingsStore.setState({
      shortcuts: {
        version: 2,
        voice: {},
        custom: { "editor.bold": [["Mod+Shift+k"]] },
        singleKeyEnabled: true,
      },
    });
    const { user } = await openEditor();
    await focusRow(user, "ctrl+shift+k");
    const rows = within(screen.getByRole("grid"))
      .getAllByRole("row")
      .filter((row) => row.hasAttribute("data-key"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("editor.bold");
  });

  it("returns focus to search when Reset removes a row from Customized", async () => {
    useShortcutSettingsStore.setState({
      shortcuts: {
        version: 2,
        voice: {},
        custom: { "global.syncNow": [["Mod+Alt+y"]] },
        singleKeyEnabled: true,
      },
    });
    const { user } = await openEditor();
    const customized = filterButton("shortcutEditor.filter.customized");
    await act(async () => customized.focus());
    await user.keyboard("{Enter}");
    await focusRow(user, "shortcuts.syncNow");
    await user.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}");
    expectFocusName(/^shortcutEditor\.reset /);
    await user.keyboard("{Enter}");
    expect(screen.getByRole("searchbox")).toHaveFocus();
  });

  it("returns focus to search when Add removes a row from No shortcut", async () => {
    const { user } = await openEditor();
    const noShortcut = filterButton("shortcutEditor.filter.none");
    await act(async () => noShortcut.focus());
    await user.keyboard("{Enter}");
    await focusRow(user, "ephemeral.clear");
    await user.keyboard("{ArrowRight}{Enter}");
    await user.keyboard("{Alt>}j{/Alt}{Enter}");
    expect(screen.getByRole("searchbox")).toHaveFocus();
  });

  it("loads a Shortcut File after a preview, replacing Custom Shortcuts", async () => {
    file.pick.mockResolvedValue(
      serializeShortcutFile({ "global.syncNow": [["Mod+Alt+y"]], "editor.bold": [["Mod+s"]] })
    );
    useShortcutSettingsStore.setState({
      shortcuts: { version: 2, voice: {}, custom: { "editor.italic": [] }, singleKeyEnabled: true },
    });
    const { user } = await openEditor();
    await narrowList(user, "shortcuts.syncNow");
    const load = screen.getByText("shortcutEditor.file.load", { selector: "button" });
    await act(async () => load.focus());
    await user.keyboard("{Enter}");

    const preview = await findDialogTitled("shortcutEditor.file.previewTitle");
    expect(preview).toHaveTextContent("shortcutEditor.file.dropped.conflict");
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(document.activeElement).toHaveTextContent("shortcutEditor.file.replace");
    await user.keyboard("{Enter}");

    expect(custom()).toEqual({ "global.syncNow": [["Mod+Alt+y"]] });
  });

  it("changes nothing for a file that is not a Shortcut File", async () => {
    file.pick.mockResolvedValue("{ not json");
    useShortcutSettingsStore.setState({
      shortcuts: { version: 2, voice: {}, custom: { "editor.italic": [] }, singleKeyEnabled: true },
    });
    const { user } = await openEditor();
    const load = screen.getByText("shortcutEditor.file.load", { selector: "button" });
    await act(async () => load.focus());
    await user.keyboard("{Enter}");

    expect(
      screen.queryByRole("dialog", { name: "shortcutEditor.file.previewTitle" })
    ).not.toBeInTheDocument();
    expect(custom()).toEqual({ "editor.italic": [] });
  });

  it("saves the Custom Shortcuts to a file", async () => {
    useShortcutSettingsStore.setState({
      shortcuts: { version: 2, voice: {}, custom: { "editor.italic": [] }, singleKeyEnabled: true },
    });
    const { user } = await openEditor();
    const save = screen.getByText("shortcutEditor.file.save", { selector: "button" });
    await act(async () => save.focus());
    await user.keyboard("{Enter}");
    expect(file.save).toHaveBeenCalledWith({ "editor.italic": [] }, {});
  });
});
