// One part of the Shortcut Editor tests, split for #851: the Voice commands describe block.
// The support module registers the mocks, so it is imported first.
import {
  expectFocusName,
  findDialogTitled,
  focusRow,
  openBoldVoice,
  openEditor,
  voice,
} from "@/test/support/shortcut-editor-dialog";
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

describe("Shortcut Editor: Voice commands", () => {
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
});
