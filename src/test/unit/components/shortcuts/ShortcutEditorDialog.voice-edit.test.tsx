// One part of the Shortcut Editor tests, split for #851: the Voice commands edit describe block.
// The support module registers the mocks, so it is imported first.
import {
  expectFocusName,
  file,
  filterButton,
  findDialogTitled,
  narrowList,
  openBoldVoice,
  openEditor,
  voice,
} from "@/test/support/shortcut-editor-dialog";
import { act, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useShortcutSettingsStore } from "@/features/settings/shortcut-store";
import { serializeShortcutFile } from "@/lib/shortcut-resolve";

describe("Shortcut Editor: Voice commands", () => {
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
