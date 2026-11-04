import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Editor as TiptapEditor } from "@tiptap/core";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEphemeralStore } from "@/features/ephemeral";
import { useNoteStore } from "@/features/notes";
import { useSettingsStore } from "@/features/settings/store";
import { Embed } from "@/pages/Embed";
import { Ephemeral } from "@/pages/Ephemeral";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@/components/dictation", () => ({ DictationBar: () => null }));

// Typing reaches the metrics worker, and jsdom has no Worker.
vi.mock("@/lib/metrics/MetricsService", () => ({
  metricsService: {
    init: vi.fn(async () => undefined),
    recordEvents: vi.fn(),
    markActive: vi.fn(),
    endSession: vi.fn(),
    discardSession: vi.fn(),
    flushNow: vi.fn(async () => undefined),
  },
}));

// jsdom has no layout, so the toolbar would measure every entry into its overflow.
vi.mock("@/components/editor/toolbar/useToolbarOverflow", () => ({
  useToolbarOverflow: () => ({ visibleCount: 100 }),
}));

const LANGUAGE_BUTTON = "editor.spellCheckLanguage";

/** The real TipTap editor behind the page; TipTap hangs it off its own element. */
function tiptap(container: HTMLElement): TiptapEditor {
  const element = container.querySelector(".ProseMirror") as
    | (HTMLElement & { editor?: TiptapEditor })
    | null;
  if (!element?.editor) throw new Error("no editor mounted");
  return element.editor;
}

/** Types through ProseMirror's own text input path, which jsdom key events skip. */
function typeText(editor: TiptapEditor, text: string) {
  const { view } = editor;
  for (const char of text) {
    const { from, to } = view.state.selection;
    const handled = view.someProp("handleTextInput", (handler) =>
      handler(view, from, to, char, () => view.state.tr.insertText(char, from, to))
    );
    if (!handled) view.dispatch(view.state.tr.insertText(char, from, to));
  }
}

async function pickLanguage(user: ReturnType<typeof userEvent.setup>, label: RegExp) {
  await user.click(screen.getByRole("button", { name: LANGUAGE_BUTTON }));
  await user.click(screen.getByRole("menuitemradio", { name: label }));
}

function renderEphemeral() {
  return render(
    <MemoryRouter initialEntries={["/ephemeral"]}>
      <Ephemeral />
    </MemoryRouter>
  );
}

describe("the Ephemeral's Spell Check language", () => {
  beforeEach(() => {
    useEphemeralStore.setState({ content: "", wordCount: 0, language: undefined });
    useSettingsStore.setState({
      language: "en",
      editorOpeningMarks: true,
      spellCheckEnabled: false,
    });
  });

  async function pickSpanish() {
    const user = userEvent.setup();
    const view = renderEphemeral();
    await waitFor(() => expect(view.container.querySelector(".ProseMirror")).not.toBeNull());
    await pickLanguage(user, /Español/);
    return view;
  }

  it("Spell Check runs in the language the author picked", async () => {
    const { container } = await pickSpanish();
    expect(tiptap(container).storage.spellCheck?.language).toBe("es");
  });

  it("the button shows the language the author picked", async () => {
    await pickSpanish();
    const button = screen.getByRole("button", { name: LANGUAGE_BUTTON });
    expect(within(button).getByText("es")).toBeTruthy();
  });

  it("Opening Marks follow the language the author picked", async () => {
    const { container } = await pickSpanish();
    const editor = tiptap(container);
    editor.commands.focus();
    typeText(editor, "hola?");
    expect(editor.getText()).toBe("¿hola?");
  });

  it("keeps the pick when the author leaves and comes back", async () => {
    const { unmount } = await pickSpanish();
    unmount();

    const { container } = renderEphemeral();
    await waitFor(() => expect(container.querySelector(".ProseMirror")).not.toBeNull());

    const button = screen.getByRole("button", { name: LANGUAGE_BUTTON });
    expect(within(button).getByText("es")).toBeTruthy();
    expect(tiptap(container).storage.spellCheck?.language).toBe("es");
  });

  it("keeps the pick after Clear", async () => {
    useEphemeralStore.setState({ content: "<p>hola</p>", wordCount: 1 });
    await pickSpanish();

    await userEvent.setup().click(screen.getByRole("button", { name: "ephemeral.clear" }));

    expect(useEphemeralStore.getState().content).toBe("");
    const button = screen.getByRole("button", { name: LANGUAGE_BUTTON });
    expect(within(button).getByText("es")).toBeTruthy();
  });

  it("Create note writes the Note in the language the author picked", async () => {
    const createNote = vi.fn().mockResolvedValue({ id: "note-1" });
    useNoteStore.setState({ createNote });
    useEphemeralStore.setState({ content: "<p>hola</p>", wordCount: 1 });
    await pickSpanish();

    await userEvent.setup().click(screen.getByRole("button", { name: "ephemeral.createNote" }));

    expect(createNote).toHaveBeenCalledWith({
      title: "",
      content: "<p>hola</p>",
      language: "es",
    });
  });

  it("Create note keeps a regional tag the Ephemeral holds", async () => {
    const createNote = vi.fn().mockResolvedValue({ id: "note-1" });
    useNoteStore.setState({ createNote });
    useEphemeralStore.setState({ content: "<p>Olá</p>", wordCount: 1, language: "pt-BR" });
    const { container } = renderEphemeral();
    await waitFor(() => expect(container.querySelector(".ProseMirror")).not.toBeNull());

    await userEvent.setup().click(screen.getByRole("button", { name: "ephemeral.createNote" }));

    expect(createNote).toHaveBeenCalledWith({
      title: "",
      content: "<p>Olá</p>",
      language: "pt-BR",
    });
  });

  it("marks its content with the app language, then with the picked one", async () => {
    const { container } = renderEphemeral();
    await waitFor(() => expect(container.querySelector(".ProseMirror")).not.toBeNull());
    const prose = container.querySelector(".ProseMirror") as HTMLElement;
    expect(prose.getAttribute("lang")).toBe("en");

    await pickLanguage(userEvent.setup(), /Español/);

    await waitFor(() => expect(prose.getAttribute("lang")).toBe("es"));
  });

  it("follows the app language until the author picks one", async () => {
    useSettingsStore.setState({ language: "es" });
    const { container } = renderEphemeral();
    await waitFor(() => expect(container.querySelector(".ProseMirror")).not.toBeNull());

    const button = screen.getByRole("button", { name: LANGUAGE_BUTTON });
    expect(within(button).getByText("es")).toBeTruthy();
    expect(tiptap(container).storage.spellCheck?.language).toBe("es");
  });

  it("an editor whose host keeps no language shows the pick too (Embed)", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <MemoryRouter initialEntries={["/embed"]}>
        <Embed />
      </MemoryRouter>
    );
    await waitFor(() => expect(container.querySelector(".ProseMirror")).not.toBeNull());

    await pickLanguage(user, /Español/);

    const button = screen.getByRole("button", { name: LANGUAGE_BUTTON });
    expect(within(button).getByText("es")).toBeTruthy();
    const editor = tiptap(container);
    editor.commands.focus();
    typeText(editor, "hola?");
    expect(editor.getText()).toBe("¿hola?");
  });
});
