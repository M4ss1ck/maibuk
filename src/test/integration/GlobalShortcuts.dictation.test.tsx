import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { toggle, setLanguage } = vi.hoisted(() => ({
  toggle: vi.fn(async () => {}),
  setLanguage: vi.fn(async () => {}),
}));
vi.mock("@/features/dictation/runtime", () => ({
  getDictation: async () => ({ session: { toggle, setLanguage }, setNotifier: vi.fn() }),
}));

const { GlobalShortcuts } = await import("@/components/GlobalShortcuts");
const { useBoundShortcutStore } = await import("@/lib/bound-shortcuts");
const { useDictationStore } = await import("@/features/dictation/store");

const { DictationControl } = await import("@/components/dictation/DictationControl");
const { DictationLiveRegion } = await import("@/components/dictation/DictationLiveRegion");
const { useShortcutSettingsStore } = await import("@/features/settings/shortcut-store");
const { MODEL_CATALOG } = await import("@/features/dictation/catalog");
const i18n = (await import("@/i18n")).default;
const { useTutorialStore } = await import("@/features/tutorial/store");
const en = MODEL_CATALOG.find((m) => m.languages[0] === "en")!.id;
const es = MODEL_CATALOG.find((m) => m.languages[0] === "es")!.id;

beforeEach(async () => {
  toggle.mockClear();
  setLanguage.mockClear();
  await i18n.changeLanguage("en");
  useShortcutSettingsStore.getState().resetAllShortcuts();
  useTutorialStore.setState({ status: "idle" });
  useDictationStore.setState({
    enabled: true,
    support: { supported: true },
    installed: [en, es],
    languageOverride: null,
    announcement: "",
  });
});

describe("dictation.toggle", () => {
  it("is bound globally and fires from inside a text field", async () => {
    const user = userEvent.setup();
    const { getByRole } = render(
      <MemoryRouter>
        <GlobalShortcuts />
        <textarea aria-label="writing" />
      </MemoryRouter>
    );
    await vi.waitFor(() =>
      expect(useBoundShortcutStore.getState().counts["dictation.toggle"]).toBeGreaterThan(0)
    );
    getByRole("textbox").focus();
    await user.keyboard("{Control>}{Shift>} {/Shift}{/Control}");
    await vi.waitFor(() => expect(toggle).toHaveBeenCalledTimes(1));
  });

  it("is not bound, and does nothing, where Dictation is unsupported", async () => {
    useDictationStore.setState({
      support: { supported: false, reason: "library_missing" },
    });
    const user = userEvent.setup();
    const { getByRole } = render(
      <MemoryRouter>
        <GlobalShortcuts />
        <textarea aria-label="writing" />
      </MemoryRouter>
    );
    expect(useBoundShortcutStore.getState().counts["dictation.toggle"] ?? 0).toBe(0);
    getByRole("textbox").focus();
    await user.keyboard("{Control>}{Shift>} {/Shift}{/Control}");
    expect(toggle).not.toHaveBeenCalled();
  });
});

describe("Cycle Dictation language", () => {
  function renderEditor(path = "/book/b1") {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <GlobalShortcuts />
        <textarea aria-label="writing" />
        <DictationControl />
        <DictationLiveRegion />
      </MemoryRouter>
    );
  }

  function bindCycle() {
    useShortcutSettingsStore
      .getState()
      .setCommandShortcuts("dictation.cycleLanguage", [["Mod+Shift+l"]]);
  }

  it.each([
    "/book/b1",
    "/notes/n1",
    "/canvas/c1",
  ])("cycles and announces from typing on %s", async (path) => {
    bindCycle();
    const user = userEvent.setup();
    renderEditor(path);
    await user.tab();
    expect(screen.getByRole("textbox", { name: "writing" })).toHaveFocus();
    for (const [code, name] of [
      ["en", "English"],
      ["es", "Spanish"],
      ["auto", "Auto"],
    ]) {
      await user.keyboard("{Control>}{Shift>}l{/Shift}{/Control}");
      await waitFor(() =>
        expect(screen.getByRole("status")).toHaveTextContent(`Dictation language: ${name}`)
      );
      expect(screen.getByRole("button", { name: /Dictation language/ })).toHaveTextContent(code);
      expect(setLanguage).toHaveBeenLastCalledWith(code === "auto" ? null : code);
      expect(screen.getByRole("textbox", { name: "writing" })).toHaveFocus();
    }
  });

  it("cycles only downloaded languages and returns to Auto after model removal", async () => {
    bindCycle();
    useDictationStore.setState({ installed: [en] });
    const user = userEvent.setup();
    renderEditor();
    await user.tab();
    for (const name of ["English", "Auto", "English"]) {
      await user.keyboard("{Control>}{Shift>}l{/Shift}{/Control}");
      await waitFor(() =>
        expect(screen.getByRole("status")).toHaveTextContent(`Dictation language: ${name}`)
      );
    }
    act(() => useDictationStore.setState({ installed: [es] }));
    await user.keyboard("{Control>}{Shift>}l{/Shift}{/Control}");
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Dictation language: Auto")
    );
  });

  it("announces the download hint without changing the language when no model exists", async () => {
    bindCycle();
    useDictationStore.setState({ installed: [] });
    const user = userEvent.setup();
    renderEditor();
    await user.tab();
    await user.keyboard("{Control>}{Shift>}l{/Shift}{/Control}");
    expect(screen.getByRole("status")).toHaveTextContent("Download a dictation model");
    expect(setLanguage).not.toHaveBeenCalled();
  });

  it("has no Default Shortcut", async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.tab();
    await user.keyboard("{Control>}{Shift>}l{/Shift}{/Control}");
    expect(setLanguage).not.toHaveBeenCalled();
  });

  it("lists the assigned Command in help and removes it when Dictation is off", async () => {
    bindCycle();
    const user = userEvent.setup();
    renderEditor();
    await user.tab();
    await user.tab();
    await user.keyboard("?");
    expect(await screen.findByRole("dialog", { name: /keyboard shortcuts/i })).toBeVisible();
    // The row also lists the Command's Voice Command, so the label text
    // appears twice while Dictation is on.
    expect(screen.getAllByText("Cycle Dictation language").length).toBeGreaterThan(0);
    act(() => useDictationStore.getState().setEnabled(false));
    expect(screen.queryByText("Cycle Dictation language")).not.toBeInTheDocument();
    expect(screen.queryByText("Start or stop dictation")).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
  });

  it("announces Spanish sentences with lowercase language names", async () => {
    await i18n.changeLanguage("es");
    bindCycle();
    const user = userEvent.setup();
    renderEditor();
    await user.tab();
    for (const name of ["inglés", "español", "Automático"]) {
      await user.keyboard("{Control>}{Shift>}l{/Shift}{/Control}");
      await waitFor(() =>
        expect(screen.getByRole("status")).toHaveTextContent(`Idioma del dictado: ${name}`)
      );
    }
  });

  it("keeps both Commands inactive during the Tutorial", async () => {
    bindCycle();
    useTutorialStore.setState({ status: "running" });
    const user = userEvent.setup();
    renderEditor();
    await user.tab();
    await user.keyboard("{Control>}{Shift>}l {/Shift}{/Control}");
    expect(toggle).not.toHaveBeenCalled();
    expect(setLanguage).not.toHaveBeenCalled();
    for (const id of ["dictation.toggle", "dictation.cycleLanguage"] as const) {
      expect(useBoundShortcutStore.getState().counts[id] ?? 0).toBe(0);
    }
  });

  it.each([
    "off",
    "unsupported",
  ])("unbounds both Commands when %s and keys do nothing", async (mode) => {
    bindCycle();
    const user = userEvent.setup();
    renderEditor();
    await user.tab();
    act(() =>
      useDictationStore.setState(
        mode === "off" ? { enabled: false } : { support: { supported: false, reason: "platform" } }
      )
    );
    for (const id of ["dictation.toggle", "dictation.cycleLanguage"] as const) {
      expect(useBoundShortcutStore.getState().counts[id] ?? 0).toBe(0);
    }
    await user.keyboard("{Control>}{Shift>}l {/Shift}{/Control}");
    expect(toggle).not.toHaveBeenCalled();
    expect(setLanguage).not.toHaveBeenCalled();
  });
});
