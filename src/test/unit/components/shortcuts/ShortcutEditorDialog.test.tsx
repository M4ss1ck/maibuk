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
    i18n: { language: "en" },
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

/**
 * A nested dialog by its title. Role queries compute every accessible name in the
 * rendered Command list, which alone takes seconds per retry under coverage.
 */
async function findDialogTitled(title: string) {
  const heading = await screen.findByText(title, { selector: "h1, h2, h3" });
  const dialog = heading.closest<HTMLElement>('[role="dialog"], [role="alertdialog"]');
  expect(dialog).not.toBeNull();
  return dialog as HTMLElement;
}

/**
 * Narrows the list before a nested dialog: user-event's Tab checks every
 * focusable control in the document, and the full Command list makes each
 * press cost seconds under coverage.
 */
async function narrowList(user: ReturnType<typeof userEvent.setup>, query: string) {
  const search = screen.getByRole("searchbox");
  await act(async () => search.focus());
  await user.keyboard(query);
}

/** The live filter toggle; the group also renders an aria-hidden copy it measures. */
function filterButton(label: string) {
  const [live] = screen
    .getAllByLabelText(label)
    .filter((button) => !button.closest('[aria-hidden="true"]'));
  return live;
}

function expectFocusName(pattern: RegExp) {
  expect(document.activeElement?.getAttribute("aria-label") ?? "").toMatch(pattern);
}

beforeEach(() => {
  useModalStore.setState({ modalIds: [], openCount: 0, closers: {} });
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

const voice = () => useShortcutSettingsStore.getState().shortcuts.voice;

/** Filters to Bold and opens its Voice commands from the row, by keyboard. */
async function openBoldVoice() {
  const { user } = await openEditor();
  await focusRow(user, "editor.bold");
  for (let press = 0; press < 8; press += 1) {
    if (
      /^shortcutEditor\.voice\.open/.test(document.activeElement?.getAttribute("aria-label") ?? "")
    )
      break;
    await user.keyboard("{ArrowRight}");
  }
  expectFocusName(/^shortcutEditor\.voice\.open/);
  const opener = document.activeElement as HTMLElement;
  await user.keyboard("{Enter}");
  const dialog = await findDialogTitled('shortcutEditor.voice.title {"command":"editor.bold"}');
  const field = within(dialog).getByRole("textbox", { name: /shortcutEditor\.voice\.addLabel/ });
  return { user, dialog, opener, field };
}

describe("Shortcut Editor: Voice commands", { timeout: 20_000 }, () => {
  it("shows the Voice list on every row", async () => {
    await openEditor();
    const user = userEvent.setup();
    await focusRow(user, "editor.bold");
    const grid = screen.getByRole("grid");
    expect(grid).toHaveTextContent(
      'shortcutEditor.voice.rowLabel {"language":"dictation.languageNames.en"}'
    );
    expect(grid).toHaveTextContent("make bold");
    await focusRow(user, "shortcuts.syncNow");
    expect(screen.getByRole("grid")).toHaveTextContent("shortcutEditor.voice.rowLabel");
    expect(screen.getByRole("grid")).toHaveTextContent("Sync now");
  });

  it("opens from the row with focus inside, and Escape returns focus to Voice", async () => {
    const { user, dialog, opener } = await openBoldVoice();
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard("{Escape}");
    await vi.waitFor(() => expect(opener).toHaveFocus());
    // The Shortcut Editor is still open underneath.
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
  });

  it("opens Voice commands on a non-editor row and lists its derived label phrase", async () => {
    const { user } = await openEditor();
    await focusRow(user, "shortcuts.gotoNotes");
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
    const opener = document.activeElement as HTMLElement;
    await user.keyboard("{Enter}");
    const dialog = await findDialogTitled(
      'shortcutEditor.voice.title {"command":"shortcuts.gotoNotes"}'
    );
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(within(dialog).getByRole("grid")).toHaveTextContent("Go to Notes");
    await user.keyboard("{Escape}");
    await vi.waitFor(() => expect(opener).toHaveFocus());
  });

  it("adds a phrase for the current Dictation Language, replacing the defaults", async () => {
    const { user, dialog, field } = await openBoldVoice();
    await act(async () => field.focus());
    await user.keyboard("heavy words{Enter}");
    const defaults = voice()["editor.bold"]?.en ?? [];
    expect(defaults[0]).toBe("heavy words");
    expect(defaults).toContain("make bold");
    expect(voice()["editor.bold"]?.es).toBeUndefined();
    expect(field).toHaveValue("");
    expect(field).toHaveFocus();
    expect(within(dialog).getByRole("status")).toHaveTextContent(
      /shortcutEditor\.voice\.announce\.added/
    );
  });

  it("refuses a one-word phrase with a message and stores nothing", async () => {
    const { user, dialog, field } = await openBoldVoice();
    await act(async () => field.focus());
    await user.keyboard("bold{Enter}");
    expect(within(dialog).getByRole("alert")).toHaveTextContent("dictation.phraseRefused.tooShort");
    expect(field).toHaveFocus();
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(voice()).toEqual({});
  });

  it("refuses another Command's phrase and a Spoken Punctuation phrase", async () => {
    const { user, dialog, field } = await openBoldVoice();
    await act(async () => field.focus());
    await user.keyboard("make italic{Enter}");
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      'dictation.phraseRefused.voiceCommand {"phrase":"make italic","command":"editor.italic"}'
    );
    await user.clear(field);
    await user.keyboard("new paragraph{Enter}");
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "dictation.phraseRefused.spokenPunctuation"
    );
    await user.clear(field);
    await user.keyboard("literal bold{Enter}");
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "dictation.spokenPunctuation.refused.escape"
    );
    expect(voice()).toEqual({});
  });

  it("edits a phrase from its row, and Escape leaves the edit without closing", async () => {
    const { user, dialog, field } = await openBoldVoice();
    const list = within(dialog).getByRole("grid");
    // Tab from the dialog's first control reaches the list's first row.
    while (!list.contains(document.activeElement)) await user.tab();
    const first = document.activeElement;
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).not.toBe(first);
    expect(document.activeElement).toHaveTextContent("make boldface");

    await user.keyboard("{Enter}");
    await vi.waitFor(() => expect(field).toHaveFocus());
    expect(field).toHaveValue("make boldface");
    expect(field).toHaveAccessibleName(/shortcutEditor\.voice\.editLabel/);
    await user.keyboard("{Escape}");
    expect(
      screen.getByText('shortcutEditor.voice.title {"command":"editor.bold"}')
    ).toBeInTheDocument();
    expect(field).toHaveValue("");

    // The list keeps its focused row; the row's Edit button edits that phrase.
    while (!list.contains(document.activeElement)) await user.tab();
    expect(document.activeElement).toHaveTextContent("make boldface");
    await user.keyboard("{ArrowRight}");
    expectFocusName(/^shortcutEditor\.voice\.edit .*make boldface/);
    await user.keyboard("{Enter}");
    await vi.waitFor(() => expect(field).toHaveFocus());
    await user.clear(field);
    await user.keyboard("set heavy{Enter}");
    const phrases = voice()["editor.bold"]?.en ?? [];
    expect(phrases[1]).toBe("set heavy");
    expect(phrases).not.toContain("make boldface");
  });

  it("removes a phrase by keyboard and resets the language to its defaults", async () => {
    const { user, dialog, field } = await openBoldVoice();
    const list = within(dialog).getByRole("grid");
    while (!list.contains(document.activeElement)) await user.tab();
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expectFocusName(/^shortcutEditor\.voice\.remove .*make bold/);
    await user.keyboard("{Enter}");
    expect(voice()["editor.bold"]?.en).not.toContain("make bold");
    expect(field).toHaveFocus();

    const reset = within(dialog).getByText(/shortcutEditor\.voice\.reset/, { selector: "button" });
    await act(async () => reset.focus());
    await user.keyboard("{Enter}");
    expect(voice()).toEqual({});
    expect(field).toHaveFocus();
  });

  it("switches to the other Dictation Language with the tabs and edits its own list", async () => {
    const { user, dialog } = await openBoldVoice();
    const english = within(dialog).getByRole("tab", { name: "dictation.languageNames.en" });
    while (document.activeElement !== english) await user.tab();
    expect(english).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{ArrowRight}");
    const spanish = within(dialog).getByRole("tab", { name: "dictation.languageNames.es" });
    expect(spanish).toHaveFocus();
    expect(spanish).toHaveAttribute("aria-selected", "true");
    expect(within(dialog).getByRole("grid")).toHaveTextContent("poner negrita");

    const spanishField = within(dialog).getByRole("textbox", {
      name: /shortcutEditor\.voice\.addLabel/,
    });
    await act(async () => spanishField.focus());
    await user.keyboard("pon esto fuerte{Enter}");
    expect(voice()["editor.bold"]?.es?.[0]).toBe("pon esto fuerte");
    expect(voice()["editor.bold"]?.en).toBeUndefined();
  });

  it("returns to English with ArrowLeft and shows its list again", async () => {
    const { user, dialog } = await openBoldVoice();
    const english = within(dialog).getByRole("tab", { name: "dictation.languageNames.en" });
    while (document.activeElement !== english) await user.tab();
    await user.keyboard("{ArrowRight}");
    expect(within(dialog).getByRole("tab", { name: "dictation.languageNames.es" })).toHaveFocus();
    expect(within(dialog).getByRole("grid")).toHaveTextContent("poner negrita");

    await user.keyboard("{ArrowLeft}");
    expect(english).toHaveFocus();
    expect(english).toHaveAttribute("aria-selected", "true");
    expect(within(dialog).getByRole("grid")).toHaveTextContent("make bold");
  });

  it("counts a Command with custom Voice commands as customized", async () => {
    useShortcutSettingsStore
      .getState()
      .setCommandVoicePhrases("editor.bold", "en", ["heavy words"]);
    const { user } = await openEditor();
    await act(async () => filterButton("shortcutEditor.filter.customized").focus());
    await user.keyboard("{Enter}");
    expect(screen.getByRole("grid")).toHaveTextContent("heavy words");
  });

  it("saves and loads Voice commands with the Shortcut File", async () => {
    useShortcutSettingsStore
      .getState()
      .setCommandVoicePhrases("editor.bold", "en", ["heavy words"]);
    const { user } = await openEditor();
    await narrowList(user, "editor.bold");
    const save = screen.getByText("shortcutEditor.file.save", { selector: "button" });
    await act(async () => save.focus());
    await user.keyboard("{Enter}");
    expect(file.save).toHaveBeenCalledWith({}, { "editor.bold": { en: ["heavy words"] } });

    file.pick.mockResolvedValue(
      serializeShortcutFile({}, { "editor.italic": { en: ["slanted words", "make bold", "tilt"] } })
    );
    const load = screen.getByText("shortcutEditor.file.load", { selector: "button" });
    await act(async () => load.focus());
    await user.keyboard("{Enter}");
    const preview = await findDialogTitled("shortcutEditor.file.previewTitle");
    expect(preview).toHaveTextContent("shortcutEditor.file.droppedVoice.conflict");
    expect(preview).toHaveTextContent("shortcutEditor.file.droppedVoice.tooShort");
    await user.keyboard("{Shift>}{Tab}{/Shift}{Enter}");
    expect(voice()).toEqual({ "editor.italic": { en: ["slanted words"] } });
  });
});
