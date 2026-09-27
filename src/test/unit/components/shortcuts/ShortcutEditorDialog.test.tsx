import { useState } from "react";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ShortcutEditorDialog } from "@/components/shortcuts/ShortcutEditorDialog";
import { useModalStore } from "@/components/ui/modal-store";
import { useShortcutSettingsStore } from "@/features/settings/shortcut-store";
import { DEFAULT_SHORTCUT_SETTINGS, serializeShortcutFile } from "@/lib/shortcut-resolve";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
}));

vi.mock("@/lib/platform/detect", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform/detect")>()),
  isMac: () => false,
}));

const file = vi.hoisted(() => ({
  save: vi.fn(async () => true),
  pick: vi.fn(async (): Promise<string | null> => null),
}));
vi.mock("@/features/settings/shortcut-file", () => ({
  saveShortcutFile: file.save,
  pickShortcutFileText: file.pick,
}));

beforeAll(() => {
  // The Virtualizer lays rows out from the scroll view's size, which jsdom reports as 0.
  Object.defineProperties(HTMLElement.prototype, {
    clientWidth: { configurable: true, get: () => 900 },
    clientHeight: { configurable: true, get: () => 4000 },
  });
});

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open editor
      </button>
      <ShortcutEditorDialog isOpen={open} onClose={() => setOpen(false)} />
    </>
  );
}

const custom = () => useShortcutSettingsStore.getState().shortcuts.custom;

async function openEditor() {
  const user = userEvent.setup();
  render(<Harness />);
  await user.tab();
  await user.keyboard("{Enter}");
  const dialog = await screen.findByRole("dialog");
  return { user, dialog };
}

/** Filters to one Command and moves focus into its row. */
async function focusRow(user: ReturnType<typeof userEvent.setup>, query: string) {
  const search = screen.getByRole("searchbox");
  await act(async () => {
    search.focus();
  });
  await user.clear(search);
  await user.keyboard(query);
  const grid = screen.getByRole("grid");
  // Tab leaves the search field for the filter group, then the grid.
  while (!grid.contains(document.activeElement)) await user.tab();
  return grid;
}

function expectFocusName(pattern: RegExp) {
  expect(document.activeElement?.getAttribute("aria-label") ?? "").toMatch(pattern);
}

beforeEach(() => {
  useModalStore.setState({ modalIds: [], openCount: 0 });
  useShortcutSettingsStore.setState({ shortcuts: structuredClone(DEFAULT_SHORTCUT_SETTINGS) });
  file.save.mockClear();
  file.pick.mockReset();
});

// Every test renders the whole virtualized Command list; under a loaded full run
// that alone can pass the default 5s budget.
describe("Shortcut Editor", { timeout: 20_000 }, () => {
  it("opens with focus inside, lists sections, and Escape closes it back to the opener", async () => {
    const { user, dialog } = await openEditor();
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(within(dialog).getByText("shortcuts.sections.common")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open editor" })).toHaveFocus();
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
        version: 1,
        custom: { "global.syncNow": [], "editor.bold": [["Mod+Shift+k"]] },
        singleKeyEnabled: true,
      },
    });
    const { user } = await openEditor();
    const resetAll = screen.getByRole("button", { name: "shortcutEditor.resetAll" });
    await act(async () => resetAll.focus());
    await user.keyboard("{Enter}");

    const confirm = await screen.findByRole("dialog", { name: "shortcutEditor.resetAllTitle" });
    await user.keyboard("{Escape}");
    expect(confirm).not.toBeInTheDocument();
    expect(Object.keys(custom())).toHaveLength(2);

    await user.keyboard("{Enter}");
    await screen.findByRole("dialog", { name: "shortcutEditor.resetAllTitle" });
    // Focus starts on the close button; the confirm button is last in the footer.
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(document.activeElement).toHaveTextContent("shortcutEditor.resetAll");
    await user.keyboard("{Enter}");
    expect(custom()).toEqual({});
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
        version: 1,
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
        version: 1,
        custom: { "global.syncNow": [["Mod+Alt+y"]] },
        singleKeyEnabled: true,
      },
    });
    const { user } = await openEditor();
    const customized = screen.getByRole("button", { name: "shortcutEditor.filter.customized" });
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
    const noShortcut = screen.getByRole("button", { name: "shortcutEditor.filter.none" });
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
      shortcuts: { version: 1, custom: { "editor.italic": [] }, singleKeyEnabled: true },
    });
    const { user } = await openEditor();
    const load = screen.getByRole("button", { name: "shortcutEditor.file.load" });
    await act(async () => load.focus());
    await user.keyboard("{Enter}");

    const preview = await screen.findByRole("dialog", { name: "shortcutEditor.file.previewTitle" });
    expect(preview).toHaveTextContent("shortcutEditor.file.dropped.conflict");
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(document.activeElement).toHaveTextContent("shortcutEditor.file.replace");
    await user.keyboard("{Enter}");

    expect(custom()).toEqual({ "global.syncNow": [["Mod+Alt+y"]] });
  });

  it("changes nothing for a file that is not a Shortcut File", async () => {
    file.pick.mockResolvedValue("{ not json");
    useShortcutSettingsStore.setState({
      shortcuts: { version: 1, custom: { "editor.italic": [] }, singleKeyEnabled: true },
    });
    const { user } = await openEditor();
    const load = screen.getByRole("button", { name: "shortcutEditor.file.load" });
    await act(async () => load.focus());
    await user.keyboard("{Enter}");

    expect(
      screen.queryByRole("dialog", { name: "shortcutEditor.file.previewTitle" })
    ).not.toBeInTheDocument();
    expect(custom()).toEqual({ "editor.italic": [] });
  });

  it("saves the Custom Shortcuts to a file", async () => {
    useShortcutSettingsStore.setState({
      shortcuts: { version: 1, custom: { "editor.italic": [] }, singleKeyEnabled: true },
    });
    const { user } = await openEditor();
    const save = screen.getByRole("button", { name: "shortcutEditor.file.save" });
    await act(async () => save.focus());
    await user.keyboard("{Enter}");
    expect(file.save).toHaveBeenCalledWith({ "editor.italic": [] });
  });
});
