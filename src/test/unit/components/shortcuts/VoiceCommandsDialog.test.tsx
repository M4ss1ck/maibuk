import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PhraseRecordingResult } from "@/features/dictation/session";
import i18n from "@/i18n";
import "@/i18n";

const rec = vi.hoisted(() => ({
  recordPhrase: vi.fn(),
  cancelRecording: vi.fn(async () => {}),
}));
vi.mock("@/features/dictation/runtime", () => ({
  getDictation: async () => ({
    session: { recordPhrase: rec.recordPhrase, cancelRecording: rec.cancelRecording },
  }),
}));

const { VoiceCommandsDialog } = await import("@/components/shortcuts/VoiceCommandsDialog");
const { useDictationStore } = await import("@/features/dictation/store");
const { useShortcutSettingsStore } = await import("@/features/settings/shortcut-store");
const { defaultVoicePhrases } = await import("@/features/dictation/voice-commands");
const { DEFAULT_SHORTCUT_SETTINGS, inactiveBindings } = await import("@/lib/shortcut-resolve");
const { registerPluginCommands } = await import("@/lib/shortcut-registry");
const { runCommand } = await import("@/lib/command-runner");

/** Undo is a whole-line Voice Command, so the dialog has phrases to list. */
const COMMAND = "common.undo";

let settle: ((result: PhraseRecordingResult) => void) | null;

function renderDialog() {
  const onClose = vi.fn();
  const view = render(<VoiceCommandsDialog id={COMMAND} initialLanguage="en" onClose={onClose} />);
  return { ...view, onClose };
}

type User = ReturnType<typeof userEvent.setup>;

/** Tabs (or Shift+Tabs) until `isFocused()` is true, keyboard-only. */
async function tabUntil(user: User, isFocused: () => boolean, { backwards = false } = {}) {
  for (let i = 0; i < 40; i++) {
    if (isFocused()) return;
    await user.tab({ shift: backwards });
  }
  expect(isFocused()).toBe(true);
}

const recordButton = () => screen.getByRole("button", { name: "Record phrase" });
const phraseField = () => screen.getByRole("textbox");

/** The Phrase Recording status line, asserted through its role so it is a live region. */
function expectStatus(text: string) {
  expect(screen.getByText(text)).toHaveAttribute("role", "status");
}

async function startRecording(user: User) {
  await tabUntil(user, () => document.activeElement === recordButton());
  await user.keyboard("{Enter}");
  await vi.waitFor(() => expect(rec.recordPhrase).toHaveBeenCalled());
}

beforeEach(async () => {
  localStorage.clear();
  settle = null;
  rec.recordPhrase.mockReset();
  rec.cancelRecording.mockClear();
  rec.recordPhrase.mockImplementation(
    () =>
      new Promise<PhraseRecordingResult>((resolve) => {
        settle = resolve;
      })
  );
  useDictationStore.setState({ enabled: true, support: { supported: true } });
  useShortcutSettingsStore.setState({ shortcuts: structuredClone(DEFAULT_SHORTCUT_SETTINGS) });
  await act(() => i18n.changeLanguage("en"));
});

afterEach(async () => {
  await act(() => i18n.changeLanguage("en"));
});

describe("VoiceCommandsDialog Phrase Recording (#270)", () => {
  it("records in the selected tab's language and says it is listening", async () => {
    const user = userEvent.setup();
    renderDialog();

    // Switch to the Spanish tab by keyboard before recording.
    const spanish = screen.getByRole("tab", { name: "Spanish" });
    const english = screen.getByRole("tab", { name: "English" });
    await tabUntil(user, () => document.activeElement === english);
    await user.keyboard("{ArrowRight}");
    await vi.waitFor(() => expect(spanish).toHaveAttribute("aria-selected", "true"));

    await startRecording(user);

    expect(rec.recordPhrase).toHaveBeenCalledWith("es");
    expect(phraseField()).toHaveFocus();
    expectStatus("Listening in Spanish. Say the phrase once; Escape cancels.");
  });

  it("fills the field with what was heard and lists it only after Add", async () => {
    const user = userEvent.setup();
    renderDialog();
    await startRecording(user);

    // "press tab" is the label phrase of the focus.next Command, so the conflict
    // check refuses it; a phrase the Command does not already answer to lands.
    await act(async () => settle?.({ kind: "heard", text: "undo everything" }));

    expect(phraseField()).toHaveValue("undo everything");
    expectStatus("Heard: undo everything");
    expect(phraseField()).toHaveFocus();
    // Nothing was added yet: the phrase list does not hold it.
    expect(screen.queryByText("undo everything")).toBeNull();

    await user.keyboard("{Enter}");
    expect(screen.getByText("undo everything")).toBeInTheDocument();
  });

  it("cancels on Escape without closing the dialog", async () => {
    const user = userEvent.setup();
    renderDialog();
    await startRecording(user);

    await user.keyboard("{Escape}");
    await vi.waitFor(() => expect(rec.cancelRecording).toHaveBeenCalled());
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await act(async () => settle?.({ kind: "cancelled" }));
    expectStatus("Recording cancelled.");
  });

  it("shows a missing model as an alert naming the language", async () => {
    const user = userEvent.setup();
    renderDialog();
    await startRecording(user);

    await act(async () => settle?.({ kind: "error", code: "model_missing", language: "es" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "No Spanish dictation model is downloaded."
    );
  });

  it("shows no record button while Dictation is off", () => {
    useDictationStore.setState({ enabled: false });
    renderDialog();
    expect(screen.queryByRole("button", { name: "Record phrase" })).toBeNull();
  });

  it("shows no record button where Dictation is unsupported", () => {
    useDictationStore.setState({ support: { supported: false } });
    renderDialog();
    expect(screen.queryByRole("button", { name: "Record phrase" })).toBeNull();
  });

  it("binds the record command to the field's focus only", async () => {
    const user = userEvent.setup();
    renderDialog();

    await tabUntil(user, () => document.activeElement === phraseField());
    await expect(runCommand("dictation.recordPhrase", { source: "voice" })).resolves.toBe("ran");
    await vi.waitFor(() => expect(rec.recordPhrase).toHaveBeenCalled());
    await act(async () => settle?.({ kind: "cancelled" }));

    // The footer's Close, not the header's (both share the name).
    const close = screen.getAllByRole("button", { name: "Close" }).at(-1)!;
    await tabUntil(user, () => document.activeElement === close);
    await expect(runCommand("dictation.recordPhrase", { source: "voice" })).resolves.toBe(
      "unavailable"
    );
  });

  it("cancels the recording when the dialog closes mid-recording", async () => {
    const user = userEvent.setup();
    const { unmount } = renderDialog();
    await startRecording(user);
    unmount();
    await vi.waitFor(() => expect(rec.cancelRecording).toHaveBeenCalledTimes(1));
  });

  it("cancels the recording when the Dictation Language tab changes", async () => {
    const user = userEvent.setup();
    renderDialog();
    await startRecording(user);

    const english = screen.getByRole("tab", { name: "English" });
    const spanish = screen.getByRole("tab", { name: "Spanish" });
    let reached = false;
    for (let i = 0; i < 50 && !reached; i++) {
      if (document.activeElement === english) reached = true;
      else await user.tab();
    }
    if (!reached) {
      for (let i = 0; i < 50 && !reached; i++) {
        if (document.activeElement === english) reached = true;
        else await user.tab({ shift: true });
      }
    }
    expect(document.activeElement).toBe(english);
    await user.keyboard("{ArrowRight}");
    await vi.waitFor(() => expect(spanish).toHaveAttribute("aria-selected", "true"));
    await vi.waitFor(() => expect(rec.cancelRecording).toHaveBeenCalled());
  });

  it("shows the busy message when another field is recording", async () => {
    const user = userEvent.setup();
    renderDialog();
    await startRecording(user);

    await act(async () => settle?.({ kind: "busy" }));
    expectStatus("Another field is recording a phrase. Stop it first.");
  });
});

describe("nested row controls by keyboard", () => {
  it.each([
    "{Enter}",
    " ",
  ])("%s on a phrase row's Remove button removes, never edits the phrase", async (key) => {
    const user = userEvent.setup();
    renderDialog();
    const rowEl = screen.getAllByRole("row")[0];
    const remove = within(rowEl).getByRole("button", { name: /^Remove / });
    const phrase = (remove.getAttribute("aria-label") ?? "")
      .replace(/^Remove /, "")
      .replace(/ from .*$/, "");
    expect(phrase.length).toBeGreaterThan(0);

    rowEl.focus();
    for (let i = 0; i < 6 && document.activeElement !== remove; i++) {
      await user.keyboard("{ArrowRight}");
    }
    expect(remove).toHaveFocus();
    await user.keyboard(key);

    // The button's own action ran: the phrase is gone from the list.
    expect(screen.queryByText(phrase)).toBeNull();
    // The row's action (startEdit) did not run: the field still adds,
    // it does not hold the removed phrase for editing.
    expect(phraseField()).toHaveValue("");
    expect(phraseField()).toHaveAccessibleName(/New voice command/);
  });
});

describe("Plugin binding conflicts on Voice reset", () => {
  const unregisters: Array<() => void> = [];
  afterEach(() => {
    while (unregisters.length > 0) unregisters.pop()?.();
  });

  function registerEchoes(label: string) {
    const unregister = registerPluginCommands("echoes", {
      defaultLanguage: "en",
      commands: [{ id: "showReport", label, contexts: ["global"], defaults: [] }],
    });
    unregisters.push(unregister);
  }

  const voice = () => useShortcutSettingsStore.getState().shortcuts.voice;
  const pluginId = "plugin.echoes.showReport" as const;

  function renderCommand(id: Parameters<typeof VoiceCommandsDialog>[0]["id"]) {
    return render(<VoiceCommandsDialog id={id} initialLanguage="en" onClose={vi.fn()} />);
  }

  async function pressReset(user: User) {
    const reset = screen.getByRole("button", { name: "Reset English to defaults" });
    await tabUntil(user, () => document.activeElement === reset);
    await user.keyboard("{Enter}");
  }

  it("prompts before a Reset takes a phrase from an active Plugin binding", async () => {
    registerEchoes("Dark theme");
    useShortcutSettingsStore
      .getState()
      .setCommandVoicePhrases("global.themeDark", "en", ["gloomy mode on"]);
    expect(inactiveBindings({}, false, voice())).toEqual([]);

    const user = userEvent.setup();
    renderCommand("global.themeDark");
    await pressReset(user);

    expect(screen.getByRole("alert")).toHaveTextContent(/dark theme/i);
    // Nothing changes until Replace.
    expect(voice()["global.themeDark"]).toEqual({ en: ["gloomy mode on"] });

    // Replace is focused first: Enter takes the phrase for the core Command.
    await user.keyboard("{Enter}");
    expect(voice()["global.themeDark"]).toBeUndefined();
    expect(voice()[pluginId]).toEqual({ en: [] });
    expect(inactiveBindings({}, false, voice())).toEqual([]);
  });

  it("Cancel keeps the Plugin phrase and restores the other Defaults", async () => {
    registerEchoes("Make bold");
    useShortcutSettingsStore
      .getState()
      .setCommandVoicePhrases("editor.bold", "en", ["heavy words"]);
    const defaults = defaultVoicePhrases("editor.bold", "en");
    expect(defaults.length).toBeGreaterThan(1);

    const user = userEvent.setup();
    renderCommand("editor.bold");
    await pressReset(user);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/make bold/i);

    // Cancel is the second button in the notice.
    const cancel = within(alert).getByRole("button", { name: "Cancel" });
    for (let press = 0; press < 6 && document.activeElement !== cancel; press += 1) {
      await user.tab();
    }
    expect(cancel).toHaveFocus();
    await user.keyboard("{Enter}");

    const kept = voice()["editor.bold"]?.en ?? [];
    expect(kept).not.toContain("make bold");
    expect(kept.length).toBe(defaults.length - 1);
    expect(voice()[pluginId]).toBeUndefined();
    expect(inactiveBindings({}, false, voice())).toEqual([]);
  });

  it("Reset with no Plugin conflict resets immediately", async () => {
    registerEchoes("Show report");
    useShortcutSettingsStore
      .getState()
      .setCommandVoicePhrases("global.themeDark", "en", ["gloomy mode on"]);

    const user = userEvent.setup();
    renderCommand("global.themeDark");
    await pressReset(user);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(voice()["global.themeDark"]).toBeUndefined();
  });
});
