import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MODEL_CATALOG } from "@/features/dictation/catalog";
import type { LineStatsSummary } from "@/features/dictation/stats";
import i18n from "@/i18n";
import "@/i18n";

const install = vi.fn(async () => {});
const remove = vi.fn(async () => {});
const cancelInstall = vi.fn();
const defaultSummary: LineStatsSummary = {
  lines: 3,
  medianLatencyMs: 120,
  medianInterpreterMs: 8,
  maxInterpreterMs: 15,
  spokenPunctuationCount: 4,
  scratchCount: 2,
  voiceCommandCount: 1,
  voiceCommandUnavailableCount: 0,
  voiceCommandRefusedCount: 0,
};
const summaryMock = vi.fn<() => LineStatsSummary>(() => defaultSummary);
vi.mock("@/features/dictation/runtime", () => ({
  getDictation: async () => ({
    install,
    remove,
    cancelInstall,
    stats: { summary: summaryMock },
    host: { inputDevice: async () => "USB Mic" },
  }),
}));
vi.mock("@/lib/platform", async (orig) => ({
  ...(await orig<object>()),
  dictationPlatform: () => "web",
}));
const { useDictationStore } = await import("@/features/dictation/store");
const { DictationSection } = await import("@/components/settings/DictationSection");

const esFast = MODEL_CATALOG.find((m) => m.languages[0] === "es" && m.tier === "fast")!;
const enFast = MODEL_CATALOG.find((m) => m.languages[0] === "en" && m.tier === "fast")!;

type User = ReturnType<typeof userEvent.setup>;

/** Tabs until `target` is the active element. */
async function tabToFocused(user: User, target: () => HTMLElement | null) {
  for (let i = 0; i < 30; i++) {
    if (target() === document.activeElement) return;
    await user.tab();
  }
  expect(target()).toHaveFocus();
}

/** Opens the Dictation settings on the Spanish tab, as the override does. */
function onSpanish() {
  useDictationStore.setState({ languageOverride: "es" });
}

beforeEach(() => {
  install.mockClear();
  remove.mockClear();
  summaryMock.mockClear();
  summaryMock.mockReturnValue(defaultSummary);
  localStorage.clear();
  useDictationStore.setState({
    enabled: true,
    support: { supported: true },
    installed: [],
    downloads: {},
    preferredTier: { en: "fast", es: "fast" },
    languageOverride: null,
    barSize: "full",
  });
});

afterEach(async () => {
  await act(() => i18n.changeLanguage("en"));
});

describe("DictationSection", () => {
  it("explains when dictation is unsupported", () => {
    useDictationStore.setState({
      support: { supported: false, reason: "not_isolated" },
    });
    render(<DictationSection />);
    expect(screen.getByText(/works in Maibuk for Linux/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /download/i })).toBeNull();
  });

  it("explains how to restore the missing Linux library", () => {
    useDictationStore.setState({
      support: { supported: false, reason: "library_missing" },
    });
    render(<DictationSection />);
    expect(
      screen.getByText(/native library is missing.*Reinstall Maibuk for Linux/i)
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /download/i })).toBeNull();
  });

  it("claims nothing while the runtime is still reporting support", () => {
    useDictationStore.setState({ support: null });
    const { container } = render(<DictationSection />);
    expect(container).toBeEmptyDOMElement();
  });

  it("downloads a model by keyboard", async () => {
    const user = userEvent.setup();
    onSpanish();
    render(<DictationSection />);
    const row = screen.getByRole("group", { name: /Spanish.*Fast/i });
    within(row)
      .getByRole("button", { name: /download/i })
      .focus();
    await user.keyboard("{Enter}");
    expect(install).toHaveBeenCalledWith(esFast);
  });

  it("shows progress and cancels", async () => {
    useDictationStore.setState({
      downloads: { [esFast.id]: { done: 10_000_000, total: 32_316_573 } },
    });
    const user = userEvent.setup();
    onSpanish();
    render(<DictationSection />);
    const row = screen.getByRole("group", { name: /Spanish.*Fast/i });
    expect(within(row).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "31");
    within(row)
      .getByRole("button", { name: /cancel/i })
      .focus();
    await user.keyboard("{Enter}");
    expect(cancelInstall).toHaveBeenCalledWith(esFast.id);
  });

  // The row's action button swapped elements on every state change, dropping
  // keyboard focus to <body> (found by the dictation E2E spec).
  it("keeps focus on the row's action through download, install, and remove", async () => {
    const { act } = await import("@testing-library/react");
    const user = userEvent.setup();
    onSpanish();
    render(<DictationSection />);
    const row = screen.getByRole("group", { name: /Spanish.*Fast/i });
    within(row)
      .getByRole("button", { name: /download/i })
      .focus();
    await user.keyboard("{Enter}");
    act(() => useDictationStore.setState({ downloads: { [esFast.id]: { done: 1, total: 2 } } }));
    expect(within(row).getByRole("button", { name: /cancel/i })).toHaveFocus();
    act(() => useDictationStore.setState({ downloads: {}, installed: [esFast.id] }));
    expect(within(row).getByRole("button", { name: /remove/i })).toHaveFocus();
    act(() => useDictationStore.setState({ installed: [] }));
    expect(within(row).getByRole("button", { name: /download/i })).toHaveFocus();
  });

  it("moves focus to Remove when a model becomes the one in use", async () => {
    useDictationStore.setState({
      installed: [esFast.id],
      preferredTier: { en: "fast", es: "accurate" },
    });
    const user = userEvent.setup();
    onSpanish();
    render(<DictationSection />);
    const row = screen.getByRole("group", { name: /Spanish.*Fast/i });
    within(row)
      .getByRole("button", { name: /use for/i })
      .focus();
    await user.keyboard("{Enter}");
    expect(within(row).getByText(/used for spanish/i)).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: /remove/i })).toHaveFocus();
  });

  it("removes an installed model by keyboard", async () => {
    useDictationStore.setState({ installed: [esFast.id] });
    const user = userEvent.setup();
    onSpanish();
    render(<DictationSection />);
    const row = screen.getByRole("group", { name: /Spanish.*Fast/i });
    within(row)
      .getByRole("button", { name: /remove/i })
      .focus();
    await user.keyboard("{Enter}");
    expect(remove).toHaveBeenCalledWith(esFast.id);
  });

  it("names the microphone when the backend can", async () => {
    render(<DictationSection />);
    expect(await screen.findByText("Microphone: USB Mic")).toBeInTheDocument();
  });

  it("says Spanish models add no punctuation", () => {
    onSpanish();
    render(<DictationSection />);
    const row = screen.getByRole("group", { name: /Spanish.*Fast/i });
    expect(within(row).getByText(/no punctuation/i)).toBeInTheDocument();
  });

  it("shows the Dictation vocabulary editor and language tabs", () => {
    render(<DictationSection />);
    expect(screen.getByRole("tablist", { name: "Dictation language" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Dictation vocabulary" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "What Dictation hears" })).toBeInTheDocument();
  });

  it("anchors each Dictation settings area once for the Tutorial", () => {
    render(<DictationSection />);
    for (const id of [
      "dictation.models",
      "dictation.language",
      "dictation.punctuation",
      "dictation.vocabulary",
    ]) {
      expect(document.querySelectorAll(`[data-tutorial~="${id}"]`), id).toHaveLength(1);
    }
  });

  it("points every Dictation step at the explanation where Dictation is unavailable", () => {
    useDictationStore.setState({ support: { supported: false, reason: "not_isolated" } });
    render(<DictationSection />);
    const explanation = screen.getByText(/works in Maibuk for Linux/i);
    expect(explanation.getAttribute("data-tutorial")).toBe(
      "dictation.models dictation.language dictation.punctuation dictation.vocabulary"
    );
    for (const id of [
      "dictation.models",
      "dictation.language",
      "dictation.punctuation",
      "dictation.vocabulary",
    ]) {
      expect(document.querySelectorAll(`[data-tutorial~="${id}"]`), id).toHaveLength(1);
    }
  });

  it("offers no Dictation switch where Dictation is unsupported", () => {
    useDictationStore.setState({ support: { supported: false, reason: "not_isolated" } });
    render(<DictationSection />);
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("turns Dictation off with Space and keeps the model rows usable", async () => {
    const user = userEvent.setup();
    onSpanish();
    render(<DictationSection />);
    const toggle = screen.getByRole("switch", { name: "Dictation" });
    expect(toggle).toBeChecked();

    await user.tab();
    expect(toggle).toHaveFocus();
    await user.keyboard(" ");

    expect(toggle).not.toBeChecked();

    const row = screen.getByRole("group", { name: /Spanish.*Fast/i });
    within(row)
      .getByRole("button", { name: /download/i })
      .focus();
    await user.keyboard("{Enter}");
    expect(install).toHaveBeenCalledWith(esFast);
  });

  it("keeps an installed model removable while Dictation is off", async () => {
    useDictationStore.setState({ enabled: false, installed: [esFast.id] });
    const user = userEvent.setup();
    onSpanish();
    render(<DictationSection />);

    expect(screen.getByRole("switch", { name: "Dictation" })).not.toBeChecked();

    const row = screen.getByRole("group", { name: /Spanish.*Fast/i });
    within(row)
      .getByRole("button", { name: /remove/i })
      .focus();
    await user.keyboard("{Enter}");
    expect(remove).toHaveBeenCalledWith(esFast.id);
  });

  it("restores an off switch from persisted storage after a reload", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<DictationSection />);
    const toggle = screen.getByRole("switch", { name: "Dictation" });
    await user.tab();
    expect(toggle).toHaveFocus();
    await user.keyboard(" ");
    expect(toggle).not.toBeChecked();

    const saved = localStorage.getItem("maibuk-dictation");
    expect(saved).not.toBeNull();
    unmount();

    // A fresh launch starts from defaults; persist then restores the record.
    useDictationStore.setState({ enabled: true, preferredTier: { en: "fast", es: "fast" } });
    localStorage.setItem("maibuk-dictation", saved!);
    await act(async () => {
      await useDictationStore.persist.rehydrate();
    });

    render(<DictationSection />);
    expect(screen.getByRole("switch", { name: "Dictation" })).not.toBeChecked();
  });

  it("defaults a legacy preferredTier-only record to Dictation on", async () => {
    useDictationStore.setState({ enabled: true, preferredTier: { en: "fast", es: "fast" } });
    localStorage.setItem(
      "maibuk-dictation",
      JSON.stringify({ state: { preferredTier: { en: "accurate", es: "fast" } }, version: 0 })
    );
    await act(async () => {
      await useDictationStore.persist.rehydrate();
    });

    render(<DictationSection />);
    expect(screen.getByRole("switch", { name: "Dictation" })).toBeChecked();
  });

  it("opens on the author's Dictation Language tab", () => {
    render(<DictationSection />);

    const tablist = screen.getByRole("tablist", { name: "Dictation language" });
    expect(
      within(tablist)
        .getAllByRole("tab")
        .map((tab) => tab.textContent)
    ).toEqual(["English", "Spanish"]);
    expect(screen.getByRole("tab", { name: "English" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Spanish" })).toHaveAttribute("aria-selected", "false");

    // Only the selected language's panel is mounted.
    expect(screen.getByRole("heading", { name: "Models" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /English.*Fast/i })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /Spanish.*Fast/i })).toBeNull();
  });

  it("moves to the Spanish tab with ArrowRight and scopes the panel to Spanish", async () => {
    useDictationStore.setState({
      vocabulary: { en: [], es: [{ heard: "nuevo párrafo", written: "Nuevo Palafox" }] },
    });
    const user = userEvent.setup();
    render(<DictationSection />);

    const english = screen.getByRole("tab", { name: "English" });
    await tabToFocused(user, () => english);
    await user.keyboard("{ArrowRight}");

    const spanish = screen.getByRole("tab", { name: "Spanish" });
    expect(spanish).toHaveFocus();
    expect(spanish).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("group", { name: /Spanish.*Fast/i })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /English.*Fast/i })).toBeNull();
    expect(
      screen.getByRole("switch", { name: "Spoken punctuation for Spanish" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("list", { name: "Dictation vocabulary for Spanish" })
    ).toBeInTheDocument();
  });

  it("names the tab list in the app language: Inglés and Español in Spanish UI", async () => {
    await act(() => i18n.changeLanguage("es"));
    onSpanish();
    useDictationStore.setState({
      installed: [esFast.id],
      preferredTier: { en: "fast", es: "accurate" },
    });
    render(<DictationSection />);

    const tablist = screen.getByRole("tablist", { name: "Idioma del dictado" });
    expect(
      within(tablist)
        .getAllByRole("tab")
        .map((tab) => tab.textContent)
    ).toEqual(["Inglés", "Español"]);
    expect(screen.getByRole("tab", { name: "Español" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "Usar para español" })).toBeInTheDocument();
  });

  it("names the tab list in English for English", () => {
    useDictationStore.setState({ installed: [enFast.id] });
    render(<DictationSection />);
    expect(screen.getByRole("tab", { name: "English" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Spanish" })).toBeInTheDocument();
  });

  it("shows the interpreter median and worst delay and spoken punctuation once on mount", async () => {
    summaryMock.mockReturnValue({
      ...defaultSummary,
      medianInterpreterMs: 1.0150000001303852,
      maxInterpreterMs: 2.0150000001303852,
    });
    render(<DictationSection />);
    expect(
      await screen.findByText(
        "Interpreter: typical delay 1.015 ms, worst delay 2.015 ms, spoken punctuation 4, voice commands 1, scratch that 2"
      )
    ).toBeInTheDocument();
  });

  it("says nothing about the interpreter until a line has been interpreted", async () => {
    summaryMock.mockReturnValue({
      lines: 1,
      medianLatencyMs: 120,
      medianInterpreterMs: null,
      maxInterpreterMs: null,
      spokenPunctuationCount: 0,
      scratchCount: 0,
      voiceCommandCount: 0,
      voiceCommandUnavailableCount: 0,
      voiceCommandRefusedCount: 0,
    });
    render(<DictationSection />);
    expect(await screen.findByText(/Recent lines: 1/)).toBeInTheDocument();
    expect(screen.queryByText(/Interpreter:/)).toBeNull();
  });

  it("names the interpreter stats in Spanish", async () => {
    await act(() => i18n.changeLanguage("es"));
    render(<DictationSection />);
    expect(
      await screen.findByText(
        "Intérprete: demora típica 8 ms, peor demora 15 ms, puntuación dictada 4, comandos de voz 1, borra eso 2"
      )
    ).toBeInTheDocument();
  });

  it("shows unavailable and refused voice command counts beside the interpreter stats", async () => {
    summaryMock.mockReturnValue({
      ...defaultSummary,
      voiceCommandUnavailableCount: 2,
      voiceCommandRefusedCount: 1,
    });
    render(<DictationSection />);
    expect(
      await screen.findByText("Unavailable voice commands: 2 Refused voice commands: 1")
    ).toBeInTheDocument();
  });

  it("names the unavailable and refused voice command counts in Spanish", async () => {
    await act(() => i18n.changeLanguage("es"));
    summaryMock.mockReturnValue({
      ...defaultSummary,
      voiceCommandUnavailableCount: 2,
      voiceCommandRefusedCount: 1,
    });
    render(<DictationSection />);
    expect(
      await screen.findByText("Comandos de voz no disponibles: 2 Comandos de voz rechazados: 1")
    ).toBeInTheDocument();
  });
});

describe("Dictation bar size", () => {
  const group = () => screen.getByRole("radiogroup", { name: "Dictation bar size" });

  it("offers Hidden, Compact, and Full with Full picked by default", () => {
    render(<DictationSection />);
    const options = within(group()).getAllByRole("radio");
    expect(options.map((o) => o.getAttribute("value"))).toEqual(["hidden", "compact", "full"]);
    expect(within(group()).getByRole("radio", { name: "Full" })).toBeChecked();
    // Compact and Full show the bar itself; Hidden is a word.
    expect(group().querySelectorAll("[data-dictation-bar-preview]")).toHaveLength(2);
    expect(group()).toHaveTextContent("Hidden");
  });

  it("picks a size with the arrow keys", async () => {
    const user = userEvent.setup();
    render(<DictationSection />);
    await user.tab();
    await user.tab();
    const full = within(group()).getByRole("radio", { name: "Full" });
    expect(full).toHaveFocus();

    await user.keyboard("{ArrowLeft}");
    expect(within(group()).getByRole("radio", { name: "Compact" })).toHaveFocus();
    expect(useDictationStore.getState().barSize).toBe("compact");

    await user.keyboard("{ArrowLeft}");
    expect(within(group()).getByRole("radio", { name: "Hidden" })).toBeChecked();
    expect(useDictationStore.getState().barSize).toBe("hidden");
  });

  it("is not offered while Dictation is off", async () => {
    const user = userEvent.setup();
    render(<DictationSection />);
    expect(group()).toBeInTheDocument();
    await user.tab();
    await user.keyboard(" ");
    expect(screen.queryByRole("radiogroup", { name: "Dictation bar size" })).toBeNull();
  });
});

