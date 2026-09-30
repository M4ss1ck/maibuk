import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  catalogCapabilities,
  defaultSpokenPunctuationSettings,
  type SpokenPunctuationLanguageSettings,
} from "@/features/dictation/spoken-punctuation";
import type { ModelSpec } from "@/features/dictation/types";
import i18n from "@/i18n";
import "@/i18n";

const rec = vi.hoisted(() => ({ recordPhrase: vi.fn() }));
vi.mock("@/features/dictation/runtime", () => ({
  getDictation: async () => ({ session: { recordPhrase: rec.recordPhrase } }),
}));

const { SpokenPunctuationSection } = await import("@/components/settings/SpokenPunctuationSection");
const { useDictationStore } = await import("@/features/dictation/store");
const { useShortcutSettingsStore } = await import("@/features/settings/shortcut-store");
const { DEFAULT_SHORTCUT_SETTINGS } = await import("@/lib/shortcut-resolve");

const punctuating: ModelSpec["capabilities"] = {
  casing: true,
  punctuation: true,
  streaming: true,
};
const bare: ModelSpec["capabilities"] = { casing: false, punctuation: false, streaming: true };

/** Renders one language's list, expanded (the collapse has its own tests). */
function renderSection(language: "en" | "es" = "en") {
  const view = render(
    <SpokenPunctuationSection
      language={language}
      capabilities={language === "en" ? punctuating : bare}
    />
  );
  // Collapsed, the disclosure trigger is the only button; its name follows the UI language.
  fireEvent.click(screen.getByRole("button", { expanded: false }));
  return view;
}

function settingsFor(language: "en" | "es"): SpokenPunctuationLanguageSettings {
  return useDictationStore.getState().spokenPunctuation[language];
}

type User = ReturnType<typeof userEvent.setup>;

/** Tabs (or Shift+Tabs) until `target` is the active element. */
async function tabToFocused(
  user: User,
  target: () => HTMLElement | null,
  { backwards = false }: { backwards?: boolean } = {}
) {
  for (let i = 0; i < 25; i++) {
    if (target() === document.activeElement) return;
    await user.tab({ shift: backwards });
  }
  expect(target()).toHaveFocus();
}

function renderCollapsed(language: "en" | "es" = "en") {
  return render(
    <SpokenPunctuationSection language={language} capabilities={catalogCapabilities(language)} />
  );
}

const languageName = (language: "en" | "es") => (language === "es" ? "Spanish" : "English");

const listTrigger = (language: "en" | "es" = "en") =>
  screen.getByRole("button", {
    name: `Spoken punctuation entries for ${languageName(language)}`,
  });
const masterSwitch = (language: "en" | "es" = "en") =>
  screen.getByRole("switch", {
    name: `Spoken punctuation for ${languageName(language)}`,
  });

beforeEach(() => {
  localStorage.clear();
  useDictationStore.setState({
    spokenPunctuation: defaultSpokenPunctuationSettings(),
    languageOverride: null,
  });
  useShortcutSettingsStore.setState({ shortcuts: structuredClone(DEFAULT_SHORTCUT_SETTINGS) });
});

afterEach(async () => {
  await act(() => i18n.changeLanguage("en"));
});

describe("SpokenPunctuationSection", () => {
  it("lists each entry's phrases and what it inserts for the chosen language", () => {
    renderSection();

    const comma = screen.getByRole("group", { name: "comma" });
    const commaPhrases = within(comma).getByRole("list", { name: "Phrases for comma" });
    expect(within(commaPhrases).getByText("comma")).toBeInTheDocument();
    expect(within(comma).getByText(",")).toBeInTheDocument();
    expect(within(comma).getByText("Inserts")).toBeInTheDocument();

    cleanup();
    renderSection("es");

    const coma = screen.getByRole("group", { name: "coma" });
    expect(
      within(within(coma).getByRole("list", { name: "Phrases for coma" })).getByText("coma")
    ).toBeInTheDocument();
    // Grouped default phrases arrive together.
    const punto = screen.getByRole("group", { name: "punto" });
    expect(within(punto).getByText("punto y seguido")).toBeInTheDocument();
    // A layout entry says what it inserts in words.
    const paragraph = screen.getByRole("group", { name: "nuevo párrafo" });
    expect(within(paragraph).getByText("New paragraph")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "comma" })).toBeNull();
  });

  it("shows the all-caps lock entries and what they insert (#271)", async () => {
    renderSection();

    const on = screen.getByRole("group", { name: "all caps on" });
    expect(within(on).getByText("Turns all caps on")).toBeInTheDocument();
    const off = screen.getByRole("group", { name: "all caps off" });
    expect(within(off).getByText("Turns all caps off")).toBeInTheDocument();

    cleanup();
    await act(() => i18n.changeLanguage("es"));
    renderSection("es");

    const activadas = screen.getByRole("group", { name: "mayúsculas activadas" });
    expect(within(activadas).getByText("Activa las mayúsculas")).toBeInTheDocument();
    const desactivadas = screen.getByRole("group", { name: "mayúsculas desactivadas" });
    expect(within(desactivadas).getByText("Desactiva las mayúsculas")).toBeInTheDocument();
  });

  it("shows the numeral entry and what it inserts (#272)", async () => {
    renderSection();

    const numeral = screen.getByRole("group", { name: "numeral" });
    expect(within(numeral).getByText("Writes the next number in digits")).toBeInTheDocument();

    cleanup();
    await act(() => i18n.changeLanguage("es"));
    renderSection("es");

    const numeralEs = screen.getByRole("group", { name: "numeral" });
    expect(within(numeralEs).getByText("Escribe el número siguiente en cifras")).toBeInTheDocument();
  });

  it("follows the model's capabilities for the initial switch state", () => {
    renderSection();
    const comma = screen.getByRole("group", { name: "comma" });
    // English models punctuate, so marks start off; layout phrases start on.
    expect(within(comma).getByRole("switch", { name: "comma" })).not.toBeChecked();
    const paragraph = screen.getByRole("group", { name: "new paragraph" });
    expect(within(paragraph).getByRole("switch", { name: "new paragraph" })).toBeChecked();
  });

  it("switches one entry off by keyboard and stores it", async () => {
    const user = userEvent.setup();
    renderSection();
    const comma = screen.getByRole("group", { name: "comma" });
    // The switch starts off for English; switch it on, then off again.
    const toggle = within(comma).getByRole("switch", { name: "comma" });
    toggle.focus();
    await user.keyboard(" ");
    expect(toggle).toBeChecked();
    await user.keyboard(" ");
    expect(toggle).not.toBeChecked();
    expect(settingsFor("en").entries.comma).toBe(false);
  });

  it("turns the whole layer off and on with the master switch", async () => {
    const user = userEvent.setup();
    renderSection();
    const master = screen.getByRole("switch", { name: "Spoken punctuation for English" });
    const comma = screen.getByRole("switch", { name: "comma" });

    master.focus();
    await user.keyboard(" ");
    expect(master).not.toBeChecked();
    expect(settingsFor("en").enabled).toBe(false);
    expect(comma).toBeDisabled();

    await user.keyboard(" ");
    expect(settingsFor("en").enabled).toBe(true);
    expect(comma).toBeEnabled();
  });

  it("adds an extra phrase and removes it again by keyboard", async () => {
    const user = userEvent.setup();
    renderSection();
    const comma = screen.getByRole("group", { name: "comma" });
    const field = within(comma).getByRole("textbox", { name: "Add a phrase to comma" });

    const toggle = within(comma).getByRole("switch", { name: "comma" });
    toggle.focus();
    await user.tab();
    expect(field).toHaveFocus();

    await user.keyboard("comma please{Enter}");

    expect(within(comma).getByText("comma please")).toBeInTheDocument();
    expect(settingsFor("en").aliases.comma).toEqual(["comma please"]);
    expect(field).toHaveFocus();
    expect(field).toHaveValue("");

    // Shift+Tab from the field lands on the new phrase's remove button.
    const remove = within(comma).getByRole("button", {
      name: "Remove comma please from comma",
    });
    await user.tab({ shift: true });
    expect(remove).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(within(comma).queryByText("comma please")).toBeNull();
    expect(settingsFor("en").aliases.comma).toBeUndefined();
    // The button unmounted; focus moved into the field, not to <body>.
    expect(field).toHaveFocus();
  });

  it("refuses a phrase that already is a Spoken punctuation phrase", async () => {
    const user = userEvent.setup();
    renderSection();
    const comma = screen.getByRole("group", { name: "comma" });
    const field = within(comma).getByRole("textbox", { name: "Add a phrase to comma" });

    field.focus();
    await user.keyboard("comma{Enter}");

    expect(within(comma).getByText("comma is already used by comma.")).toBeInTheDocument();
    expect(within(comma).getByRole("alert")).toBeInTheDocument();
    expect(settingsFor("en").aliases.comma).toBeUndefined();
    expect(field).toHaveFocus();
  });

  it("names the owning entry when another entry already answers to the phrase", async () => {
    const user = userEvent.setup();
    renderSection();
    const comma = screen.getByRole("group", { name: "comma" });
    const commaField = within(comma).getByRole("textbox", { name: "Add a phrase to comma" });
    commaField.focus();
    await user.keyboard("comma please{Enter}");

    const period = screen.getByRole("group", { name: "period" });
    const periodField = within(period).getByRole("textbox", { name: "Add a phrase to period" });
    periodField.focus();
    await user.keyboard("comma please{Enter}");

    expect(within(period).getByRole("alert")).toHaveTextContent(
      "comma please is already used by comma."
    );
    expect(settingsFor("en").aliases.period).toBeUndefined();
  });

  it("refuses an escape alias that would shadow another phrase, naming both", async () => {
    const user = userEvent.setup();
    renderSection();
    const comma = screen.getByRole("group", { name: "comma" });
    const commaField = within(comma).getByRole("textbox", { name: "Add a phrase to comma" });
    commaField.focus();
    await user.keyboard("komma please{Enter}");

    const literal = screen.getByRole("group", { name: "literal" });
    const literalField = within(literal).getByRole("textbox", {
      name: "Add a phrase to literal",
    });
    literalField.focus();
    await user.keyboard("komma{Enter}");

    expect(within(literal).getByRole("alert")).toHaveTextContent(
      "komma is the start of komma please, used by comma."
    );
    expect(settingsFor("en").aliases.literal).toBeUndefined();
    expect(settingsFor("en").aliases.comma).toEqual(["komma please"]);
  });

  it("refuses a phrase that starts with the escape word", async () => {
    const user = userEvent.setup();
    renderSection();
    const comma = screen.getByRole("group", { name: "comma" });
    const field = within(comma).getByRole("textbox", { name: "Add a phrase to comma" });

    field.focus();
    await user.keyboard("literal comma{Enter}");

    expect(
      within(comma).getByText("literal comma starts with the escape word, literal.")
    ).toBeInTheDocument();
    expect(settingsFor("en").aliases.comma).toBeUndefined();
  });

  it("refuses a phrase that is a Voice Command, default or the author's own", async () => {
    const user = userEvent.setup();
    useShortcutSettingsStore
      .getState()
      .setCommandVoicePhrases("editor.italic", "en", ["slanted words"]);
    renderSection();
    const comma = screen.getByRole("group", { name: "comma" });
    const field = within(comma).getByRole("textbox", { name: "Add a phrase to comma" });

    field.focus();
    await user.keyboard("make bold{Enter}");
    expect(within(comma).getByRole("alert")).toHaveTextContent("make bold already runs Bold.");

    await user.clear(field);
    await user.keyboard("slanted words{Enter}");
    expect(within(comma).getByRole("alert")).toHaveTextContent(
      "slanted words already runs Italic."
    );
    expect(settingsFor("en").aliases.comma).toBeUndefined();
    expect(field).toHaveFocus();
  });

  it("resets one entry's switch and phrases to the defaults", async () => {
    const user = userEvent.setup();
    renderSection();
    const comma = screen.getByRole("group", { name: "comma" });
    const toggle = within(comma).getByRole("switch", { name: "comma" });
    toggle.focus();
    await user.keyboard(" ");
    const field = within(comma).getByRole("textbox", { name: "Add a phrase to comma" });
    field.focus();
    await user.keyboard("comma please{Enter}");
    expect(within(comma).getByText("comma please")).toBeInTheDocument();

    // The field is empty, so Tab skips the disabled Add and lands on Reset.
    const reset = within(comma).getByRole("button", {
      name: "Reset comma to its default switch and phrases",
    });
    await user.tab();
    expect(reset).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(within(comma).queryByText("comma please")).toBeNull();
    expect(toggle).not.toBeChecked();
    expect(settingsFor("en").entries.comma).toBeUndefined();
    expect(settingsFor("en").aliases.comma).toBeUndefined();
    // The Reset button unmounted; focus moved into the field, not to <body>.
    expect(field).toHaveFocus();
  });

  it("shows the glossary copy in Spanish and starts on the Spanish entries", async () => {
    await act(() => i18n.changeLanguage("es"));
    const user = userEvent.setup();
    renderSection("es");

    expect(screen.getByRole("heading", { name: "Puntuación dictada" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Puntuación dictada para Español" })).toBeChecked();
    const coma = screen.getByRole("group", { name: "coma" });
    expect(within(coma).getByText("Inserta")).toBeInTheDocument();

    const field = within(coma).getByRole("textbox", { name: "Agregar una frase a coma" });
    field.focus();
    await user.keyboard("punto{Enter}");
    expect(within(coma).getByText("punto ya lo usa punto.")).toBeInTheDocument();
  });

  describe("collapse", () => {
    it("starts collapsed and expands and collapses from the trigger by keyboard", async () => {
      const user = userEvent.setup();
      renderCollapsed();

      expect(screen.queryByRole("group", { name: "comma" })).toBeNull();

      const trigger = listTrigger();
      await tabToFocused(user, () => trigger);
      expect(trigger).toHaveAttribute("aria-expanded", "false");

      await user.keyboard("{Enter}");
      expect(trigger).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByRole("group", { name: "comma" })).toBeInTheDocument();

      await user.keyboard("{Enter}");
      expect(trigger).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByRole("group", { name: "comma" })).toBeNull();
    });

    it("toggles the master switch with Space without expanding the list", async () => {
      const user = userEvent.setup();
      renderCollapsed();
      // Query once: each getByRole walks the hidden panel's ~50 controls, and a
      // re-query per Tab pushed this past the 5s timeout on a loaded CI runner.
      const master = masterSwitch();

      await tabToFocused(user, () => master);
      expect(master).toBeChecked();

      await user.keyboard(" ");

      expect(master).not.toBeChecked();
      expect(screen.queryByRole("group", { name: "comma" })).toBeNull();
    });

    it("shows the Spanish entries after expanding", async () => {
      const user = userEvent.setup();
      renderCollapsed("es");

      expect(screen.queryByRole("group", { name: "coma" })).toBeNull();

      const trigger = listTrigger("es");
      await tabToFocused(user, () => trigger);
      await user.keyboard("{Enter}");

      expect(masterSwitch("es")).toBeInTheDocument();
      expect(screen.getByRole("group", { name: "coma" })).toBeInTheDocument();
    });

    it("disables the entry switches while the master switch is off", async () => {
      const user = userEvent.setup();
      renderCollapsed();

      const trigger = listTrigger();
      await tabToFocused(user, () => trigger);
      await user.keyboard("{Enter}");
      const commaSwitch = screen.getByRole("switch", { name: "comma" });
      expect(commaSwitch).toBeEnabled();

      const master = masterSwitch();
      await tabToFocused(user, () => master, { backwards: true });
      await user.keyboard(" ");

      expect(master).not.toBeChecked();
      expect(commaSwitch).toBeDisabled();
    });
  });
});

describe("SpokenPunctuationSection Phrase Recording (#270)", () => {
  beforeEach(() => {
    rec.recordPhrase.mockReset();
    useDictationStore.setState({ support: { supported: true } });
  });

  afterEach(() => {
    useDictationStore.setState({ support: null });
  });

  it("fills one entry's alias field from a recording, leaving the others empty", async () => {
    rec.recordPhrase.mockResolvedValue({ kind: "heard", text: "comma please" });
    const user = userEvent.setup();
    renderSection();

    const comma = screen.getByRole("group", { name: "comma" });
    const commaField = within(comma).getByRole("textbox", { name: "Add a phrase to comma" });
    const record = within(comma).getByRole("button", { name: "Record a phrase for comma" });
    record.focus();
    await user.keyboard("{Enter}");

    await waitFor(() => expect(commaField).toHaveValue("comma please"));
    // The recording belongs to this entry's field, and nothing was submitted.
    const period = screen.getByRole("group", { name: "period" });
    expect(within(period).getByRole("textbox", { name: "Add a phrase to period" })).toHaveValue("");
    expect(settingsFor("en").aliases?.comma).toBeUndefined();
  });
});
