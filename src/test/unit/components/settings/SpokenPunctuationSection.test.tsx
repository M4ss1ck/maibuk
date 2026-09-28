import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  defaultSpokenPunctuationSettings,
  type SpokenPunctuationLanguageSettings,
} from "@/features/dictation/spoken-punctuation";
import type { ModelSpec } from "@/features/dictation/types";
import i18n from "@/i18n";
import "@/i18n";

const { SpokenPunctuationSection } = await import("@/components/settings/SpokenPunctuationSection");
const { useDictationStore } = await import("@/features/dictation/store");

const punctuating: ModelSpec["capabilities"] = {
  casing: true,
  punctuation: true,
  streaming: true,
};
const bare: ModelSpec["capabilities"] = { casing: false, punctuation: false, streaming: true };

function renderSection() {
  return render(
    <SpokenPunctuationSection
      languages={["en", "es"]}
      capabilitiesFor={(language) => (language === "en" ? punctuating : bare)}
    />
  );
}

function settingsFor(language: "en" | "es"): SpokenPunctuationLanguageSettings {
  return useDictationStore.getState().spokenPunctuation[language];
}

async function chooseSpanish(user: ReturnType<typeof userEvent.setup>) {
  // React Aria names the trigger with its value plus the Select's label.
  const select = screen.getByRole("button", { name: /Dictation language/ });
  select.focus();
  await user.keyboard("{Enter}");
  await user.keyboard("{ArrowDown}{Enter}");
}

beforeEach(() => {
  localStorage.clear();
  useDictationStore.setState({
    spokenPunctuation: defaultSpokenPunctuationSettings(),
    languageOverride: null,
  });
});

afterEach(async () => {
  await act(() => i18n.changeLanguage("en"));
});

describe("SpokenPunctuationSection", () => {
  it("lists each entry's phrases and what it inserts for the chosen language", async () => {
    const user = userEvent.setup();
    renderSection();

    const comma = screen.getByRole("group", { name: "comma" });
    const commaPhrases = within(comma).getByRole("list", { name: "Phrases for comma" });
    expect(within(commaPhrases).getByText("comma")).toBeInTheDocument();
    expect(within(comma).getByText(",")).toBeInTheDocument();
    expect(within(comma).getByText("Inserts")).toBeInTheDocument();

    await chooseSpanish(user);

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
  });

  it("refuses a phrase that already is a Spoken punctuation phrase", async () => {
    const user = userEvent.setup();
    renderSection();
    const comma = screen.getByRole("group", { name: "comma" });
    const field = within(comma).getByRole("textbox", { name: "Add a phrase to comma" });

    field.focus();
    await user.keyboard("comma{Enter}");

    expect(
      within(comma).getByText("comma is already a Spoken punctuation phrase.")
    ).toBeInTheDocument();
    expect(within(comma).getByRole("alert")).toBeInTheDocument();
    expect(settingsFor("en").aliases.comma).toBeUndefined();
    expect(field).toHaveFocus();
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
  });

  it("shows the glossary copy in Spanish and starts on the Spanish entries", async () => {
    await act(() => i18n.changeLanguage("es"));
    const user = userEvent.setup();
    renderSection();

    expect(screen.getByRole("heading", { name: "Puntuación dictada" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Puntuación dictada para Español" })).toBeChecked();
    const coma = screen.getByRole("group", { name: "coma" });
    expect(within(coma).getByText("Inserta")).toBeInTheDocument();

    const field = within(coma).getByRole("textbox", { name: "Agregar una frase a coma" });
    field.focus();
    await user.keyboard("punto{Enter}");
    expect(
      within(coma).getByText("punto ya es una frase de Puntuación dictada.")
    ).toBeInTheDocument();
  });

  it("opens the language Select with the keyboard", async () => {
    const user = userEvent.setup();
    renderSection();
    const select = screen.getByRole("button", { name: /Dictation language/ });
    select.focus();
    await user.keyboard("{Enter}");

    const listbox = screen.getByRole("listbox");
    expect(within(listbox).getByRole("option", { name: "Spanish" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
