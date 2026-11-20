// One part of the Shortcut Editor tests, split for #851: nested row controls and Plugin Commands.
// The support module registers the mocks, so it is imported first.
import {
  custom,
  expectFocusName,
  findDialogTitled,
  focusRow,
  openEditor,
} from "@/test/support/shortcut-editor-dialog";
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { useShortcutSettingsStore } from "@/features/settings/shortcut-store";
import { effectiveShortcuts } from "@/lib/shortcut-resolve";
import { registerPluginCommands } from "@/lib/shortcut-registry";

describe("nested row controls by keyboard", () => {
  // These GridList rows carry no row-level onAction: the assertion is that the
  // nested Voice button's own action (opening the Voice dialog) runs and no
  // row activation happens alongside it.
  it.each([
    "{Enter}",
    " ",
  ])("%s on a row's Voice button opens Voice commands, never the row", async (key) => {
    const { user } = await openEditor();
    await focusRow(user, "editor.bold");
    for (let press = 0; press < 8; press += 1) {
      if (
        /^shortcutEditor\.voice\.open/.test(
          document.activeElement?.getAttribute("aria-label") ?? ""
        )
      )
        break;
      await user.keyboard("{ArrowRight}");
    }
    expectFocusName(/^shortcutEditor\.voice\.open/);
    await user.keyboard(key);
    const dialog = await findDialogTitled('shortcutEditor.voice.title {"command":"editor.bold"}');
    expect(dialog).toBeInTheDocument();
  });
});

describe("Plugin Commands in the Shortcut Editor", () => {
  const unregisters: Array<() => void> = [];
  afterEach(() => {
    while (unregisters.length > 0) unregisters.pop()?.();
  });

  function registerEchoes(defaults: string[][] = [], label = "Show report") {
    const unregister = registerPluginCommands("echoes", {
      defaultLanguage: "en",
      commands: [
        {
          id: "showReport",
          label,
          contexts: ["global"],
          defaults: defaults as [string][],
        },
      ],
    });
    unregisters.push(unregister);
    return unregister;
  }

  it("lists a registered Command under Plugins and drops it when unregistered", async () => {
    registerEchoes();
    const { user } = await openEditor();
    await focusRow(user, "Show report");

    expect(screen.getByText("shortcuts.sections.plugins")).toBeInTheDocument();
    expect(screen.getAllByText("Show report").length).toBeGreaterThan(0);

    act(() => unregisters.pop()?.());
    expect(screen.queryAllByText("Show report")).toEqual([]);
    expect(screen.queryByText("shortcuts.sections.plugins")).not.toBeInTheDocument();
  });

  it("shows the Fixed navigation reason on a page Command's lifted Arrow", async () => {
    const unregister = registerPluginCommands("echoes", {
      defaultLanguage: "en",
      pages: ["report"],
      commands: [
        {
          id: "nudge",
          label: "Nudge selection",
          contexts: ["report"],
          defaults: [["ArrowDown"]],
        },
      ],
    });
    unregisters.push(unregister);
    const { user } = await openEditor();
    await focusRow(user, "Nudge selection");

    expect(screen.getByText("shortcuts.fixed.navigation")).toBeInTheDocument();
  });

  it("shows a conflicting Plugin Default Shortcut as inactive", async () => {
    // The core binding is a Custom Shortcut: an existing binding, so the
    // Plugin's Default stays inactive (a core Default would be the newcomer).
    useShortcutSettingsStore
      .getState()
      .setCommandShortcuts("common.save", [["Mod+s"], ["Mod+Alt+s"]]);
    registerEchoes([["Mod+s"]]);
    const { user } = await openEditor();
    await focusRow(user, "Show report");

    expect(screen.getByText("shortcutEditor.inactive")).toBeInTheDocument();
  });

  it("shows a conflicting Plugin Voice phrase as inactive", async () => {
    registerEchoes([], "Dark theme");
    const { user } = await openEditor();
    await focusRow(user, "Dark theme");

    expect(screen.getAllByText("shortcutEditor.inactive").length).toBeGreaterThan(0);
  });

  /** Moves through a row's controls with ArrowRight until Reset has focus. */
  async function focusReset(user: ReturnType<typeof userEvent.setup>) {
    for (let press = 0; press < 8; press += 1) {
      if (
        /^shortcutEditor\.reset /.test(document.activeElement?.getAttribute("aria-label") ?? "")
      ) {
        return;
      }
      await user.keyboard("{ArrowRight}");
    }
    expectFocusName(/^shortcutEditor\.reset /);
  }

  it("prompts before a Reset takes a key from an active Plugin binding", async () => {
    registerEchoes([["Mod+s"]]);
    useShortcutSettingsStore.getState().setCommandShortcuts("common.save", [["Mod+Alt+s"]]);
    const pluginId = "plugin.echoes.showReport" as const;
    // Save no longer uses Mod+S, so the Plugin's binding is active.
    expect(effectiveShortcuts(pluginId, custom(), false)).toEqual([["Mod+s"]]);

    const { user } = await openEditor();
    await focusRow(user, "shortcuts.save");
    await focusReset(user);
    await user.keyboard("{Enter}");

    expect(screen.getByRole("alert")).toHaveTextContent("shortcutEditor.conflict.message");
    // Nothing changes until Replace.
    expect(custom()["common.save"]).toEqual([["Mod+Alt+s"]]);
    expect(effectiveShortcuts(pluginId, custom(), false)).toEqual([["Mod+s"]]);

    // Replace is focused first: Enter takes the key for Save.
    await user.keyboard("{Enter}");
    expect(custom()["common.save"]).toBeUndefined();
    expect(custom()[pluginId]).toEqual([]);
    expect(effectiveShortcuts(pluginId, custom(), false)).toEqual([]);
  });

  it("Cancel keeps the Plugin binding and restores the other Defaults", async () => {
    registerEchoes([["F11"]]);
    useShortcutSettingsStore
      .getState()
      .setCommandShortcuts("bookEditor.focusMode", [["Mod+Alt+f"]]);
    const pluginId = "plugin.echoes.showReport" as const;

    const { user } = await openEditor();
    await focusRow(user, "shortcuts.toggleFocusMode");
    await focusReset(user);
    await user.keyboard("{Enter}");
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("shortcutEditor.conflict.message");

    // Cancel is the second button in the notice.
    const cancel = within(alert).getByRole("button", { name: "common.cancel" });
    // The row's arrow navigation reaches the notice's second button.
    await user.keyboard("{ArrowRight}");
    expect(cancel).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(custom()["bookEditor.focusMode"]).toEqual([["Mod+Shift+f"]]);
    expect(effectiveShortcuts(pluginId, custom(), false)).toEqual([["F11"]]);
    expect(screen.getByRole("status")).toHaveTextContent("shortcutEditor.announce.resetKept");
  });

  it("Reset with no Plugin conflict resets immediately", async () => {
    registerEchoes([["Mod+Alt+k"]]);
    useShortcutSettingsStore.getState().setCommandShortcuts("common.save", [["Mod+Alt+s"]]);

    const { user } = await openEditor();
    await focusRow(user, "shortcuts.save");
    await focusReset(user);
    await user.keyboard("{Enter}");

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(custom()["common.save"]).toBeUndefined();
  });
});
