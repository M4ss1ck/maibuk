import { act, render, screen } from "@testing-library/react";
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
const { DEFAULT_SHORTCUT_SETTINGS } = await import("@/lib/shortcut-resolve");
const { runCommand } = await import("@/lib/command-runner");

/** Undo is a whole-line Voice Command, so the dialog has phrases to list. */
const COMMAND = "common.undo";

let settle: ((result: PhraseRecordingResult) => void) | null;

function renderDialog() {
  const onClose = vi.fn();
  const view = render(
    <VoiceCommandsDialog id={COMMAND} initialLanguage="en" onClose={onClose} />
  );
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
