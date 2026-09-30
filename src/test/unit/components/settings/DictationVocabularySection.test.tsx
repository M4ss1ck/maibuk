import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultVocabularySettings } from "@/features/dictation/vocabulary";
import i18n from "@/i18n";
import "@/i18n";

const rec = vi.hoisted(() => ({ recordPhrase: vi.fn() }));
vi.mock("@/features/dictation/runtime", () => ({
  getDictation: async () => ({ session: { recordPhrase: rec.recordPhrase } }),
}));

const { DictationVocabularySection } = await import(
  "@/components/settings/DictationVocabularySection"
);
const { useDictationStore } = await import("@/features/dictation/store");

function renderSection(language: "en" | "es" = "en") {
  return render(<DictationVocabularySection language={language} />);
}

function vocabularyFor(language: "en" | "es") {
  return useDictationStore.getState().vocabulary[language];
}

/** The add form's two fields; the edit form adds a second, scoped pair. */
const EN = { heard: "What Dictation hears", written: "Write instead" };
const ES = { heard: "Lo que oye Dictado", written: "Escribir en su lugar" };

function addFields(labels = EN) {
  return {
    heard: screen.getByRole("textbox", { name: labels.heard }),
    written: screen.getByRole("textbox", { name: labels.written }),
  };
}

function editFields(phrase: string) {
  const form = screen.getByRole("form", { name: `Edit ${phrase}` });
  return {
    form,
    heard: within(form).getByRole("textbox", { name: EN.heard }),
    written: within(form).getByRole("textbox", { name: EN.written }),
  };
}

async function addEntry(
  user: ReturnType<typeof userEvent.setup>,
  heard: string,
  written: string,
  labels = EN
) {
  const fields = addFields(labels);
  fields.heard.focus();
  await user.keyboard(heard);
  await user.tab();
  await user.keyboard(`${written}{Enter}`);
}

beforeEach(() => {
  localStorage.clear();
  useDictationStore.setState({
    vocabulary: defaultVocabularySettings(),
    languageOverride: null,
  });
});

afterEach(async () => {
  await act(() => i18n.changeLanguage("en"));
});

describe("DictationVocabularySection", () => {
  it("shows the empty state until the first entry", () => {
    renderSection();
    expect(screen.getByRole("heading", { name: "Dictation vocabulary" })).toBeInTheDocument();
    expect(
      screen.getByText("No entries yet. Add the first word Dictation gets wrong.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: /Dictation vocabulary for/ })).toBeNull();
  });

  it("adds an entry by keyboard and keeps focus in the add form", async () => {
    const user = userEvent.setup();
    renderSection();
    await addEntry(user, "a reliano", "Aureliano");

    const list = screen.getByRole("list", { name: "Dictation vocabulary for English" });
    expect(within(list).getByText("a reliano")).toBeInTheDocument();
    expect(within(list).getByText("Aureliano")).toBeInTheDocument();
    expect(vocabularyFor("en")).toEqual([{ heard: "a reliano", written: "Aureliano" }]);
    // The form is ready for the next word instead of dropping focus to <body>.
    const fields = addFields();
    expect(fields.heard).toHaveFocus();
    expect(fields.heard).toHaveValue("");
    expect(fields.written).toHaveValue("");
  });

  it("refuses a heard form that already has an entry, folded, with an alert", async () => {
    const user = userEvent.setup();
    renderSection();
    await addEntry(user, "a reliano", "Aureliano");
    await addEntry(user, "A RELIANO", "Otro");

    expect(screen.getByRole("alert")).toHaveTextContent(
      "A RELIANO is already in the Dictation vocabulary."
    );
    expect(vocabularyFor("en")).toEqual([{ heard: "a reliano", written: "Aureliano" }]);
    expect(addFields().heard).toHaveFocus();
  });

  it("edits an entry by keyboard and returns focus to its Edit button", async () => {
    const user = userEvent.setup();
    renderSection();
    await addEntry(user, "a reliano", "Aureliano");

    const edit = screen.getByRole("button", { name: "Edit a reliano" });
    edit.focus();
    await user.keyboard("{Enter}");

    const fields = editFields("a reliano");
    expect(fields.heard).toHaveFocus();
    expect(fields.heard).toHaveValue("a reliano");
    expect(fields.written).toHaveValue("Aureliano");

    await user.keyboard(" buendía");
    await user.tab();
    // Tabbing into the field selects its text, so typing replaces it.
    await user.keyboard("Aureliano Buendía{Enter}");

    expect(vocabularyFor("en")).toEqual([
      { heard: "a reliano buendía", written: "Aureliano Buendía" },
    ]);
    const updated = screen.getByRole("button", { name: "Edit a reliano buendía" });
    expect(updated).toHaveFocus();
    expect(screen.queryByRole("form", { name: /Edit/ })).toBeNull();
  });

  it("cancels an edit with Escape and returns focus to its Edit button", async () => {
    const user = userEvent.setup();
    renderSection();
    await addEntry(user, "a reliano", "Aureliano");

    const edit = screen.getByRole("button", { name: "Edit a reliano" });
    edit.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" otro");
    await user.keyboard("{Escape}");

    expect(vocabularyFor("en")).toEqual([{ heard: "a reliano", written: "Aureliano" }]);
    expect(screen.getByRole("button", { name: "Edit a reliano" })).toHaveFocus();
    expect(screen.queryByRole("form", { name: /Edit/ })).toBeNull();
  });

  it("refuses an edit that would repeat another entry's heard form", async () => {
    const user = userEvent.setup();
    renderSection();
    await addEntry(user, "a reliano", "Aureliano");
    await addEntry(user, "buendía", "Buendía");

    screen.getByRole("button", { name: "Edit buendía" }).focus();
    await user.keyboard("{Enter}");
    const fields = editFields("buendía");
    fields.heard.focus();
    // The field is prefilled; select all and replace with the other entry's sound.
    await user.keyboard("{Control>}a{/Control}a reliano{Enter}");

    expect(vocabularyFor("en")).toEqual([
      { heard: "a reliano", written: "Aureliano" },
      { heard: "buendía", written: "Buendía" },
    ]);
    // The edit form stays open with the refusal so the author can fix it.
    expect(screen.getByRole("alert")).toHaveTextContent(
      "a reliano is already in the Dictation vocabulary."
    );
    expect(editFields("buendía").heard).toHaveFocus();
  });

  it("removes an entry by keyboard and keeps focus in the add form", async () => {
    const user = userEvent.setup();
    renderSection();
    await addEntry(user, "a reliano", "Aureliano");

    const remove = screen.getByRole("button", { name: "Remove a reliano" });
    remove.focus();
    await user.keyboard("{Enter}");

    expect(vocabularyFor("en")).toEqual([]);
    expect(screen.queryByText("Aureliano")).toBeNull();
    expect(addFields().heard).toHaveFocus();
  });

  it("keeps entries per Dictation Language", async () => {
    const user = userEvent.setup();
    const { unmount } = renderSection("en");
    await addEntry(user, "a reliano", "Aureliano");
    expect(vocabularyFor("en")).toEqual([{ heard: "a reliano", written: "Aureliano" }]);
    unmount();

    // The Spanish editor is a separate render: no shared selector, no leakage.
    renderSection("es");
    expect(vocabularyFor("es")).toEqual([]);
    expect(
      screen.getByText("No entries yet. Add the first word Dictation gets wrong.")
    ).toBeInTheDocument();
    expect(screen.queryByText("Aureliano")).toBeNull();

    await addEntry(user, "nuevo párrafo", "Nuevo Palafox");
    expect(vocabularyFor("es")).toEqual([{ heard: "nuevo párrafo", written: "Nuevo Palafox" }]);
    const list = screen.getByRole("list", { name: "Dictation vocabulary for Spanish" });
    expect(within(list).getByText("Nuevo Palafox")).toBeInTheDocument();
    expect(within(list).queryByText("Aureliano")).toBeNull();
  });

  it("shows the glossary copy in Spanish", async () => {
    await act(() => i18n.changeLanguage("es"));
    const user = userEvent.setup();
    renderSection("es");

    expect(screen.getByRole("heading", { name: "Vocabulario de dictado" })).toBeInTheDocument();
    await addEntry(user, "a reliano", "Aureliano", ES);
    await addEntry(user, "a reliano", "Otro", ES);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "a reliano ya está en el vocabulario de dictado."
    );
    expect(screen.getByRole("button", { name: "Editar a reliano" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quitar a reliano" })).toBeInTheDocument();
  });
});

describe("DictationVocabularySection Phrase Recording (#270)", () => {
  beforeEach(() => {
    rec.recordPhrase.mockReset();
    // The record button only exists where Dictation is supported; each case
    // turns it on once the setup that relies on the old Tab order is done.
    useDictationStore.setState({ support: null });
  });

  afterEach(() => {
    useDictationStore.setState({ support: null });
  });

  it("fills only the add form's heard field with what Dictation heard", async () => {
    rec.recordPhrase.mockResolvedValue({ kind: "heard", text: "a reliano" });
    const user = userEvent.setup();
    renderSection();
    act(() => useDictationStore.setState({ support: { supported: true } }));

    const record = screen.getByRole("button", { name: "Record what Dictation hears" });
    record.focus();
    await user.keyboard("{Enter}");

    await waitFor(() => expect(addFields().heard).toHaveValue("a reliano"));
    // The written form is what the author wants on the page: never recorded.
    expect(addFields().written).toHaveValue("");
  });

  it("fills only the edit form's heard field, leaving the written form alone", async () => {
    rec.recordPhrase.mockResolvedValue({ kind: "heard", text: "buendía" });
    const user = userEvent.setup();
    renderSection();
    await addEntry(user, "a reliano", "Aureliano");
    act(() => useDictationStore.setState({ support: { supported: true } }));

    screen.getByRole("button", { name: "Edit a reliano" }).focus();
    await user.keyboard("{Enter}");

    const form = editFields("a reliano").form;
    const record = within(form).getByRole("button", { name: "Record what Dictation hears" });
    record.focus();
    await user.keyboard("{Enter}");

    await waitFor(() => expect(editFields("a reliano").heard).toHaveValue("buendía"));
    expect(editFields("a reliano").written).toHaveValue("Aureliano");
  });
});
