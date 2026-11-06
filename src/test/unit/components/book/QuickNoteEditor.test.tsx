import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QuickNoteEditor } from "@/components/book/QuickNoteEditor";
import { useModalStore } from "@/components/ui/modal-store";
import { forgetEditor, lastFocusedEditor } from "@/components/editor/editor-command-source";
import { useSearchSwitchesStore } from "@/features/search/switches";
import { useSettingsStore } from "@/features/settings/store";
import { useTutorialStore } from "@/features/tutorial/store";
import { runCommand } from "@/lib/command-runner";

// jsdom does not implement elementFromPoint, which ProseMirror calls during
// mousedown handling. Polyfill it to avoid uncaught exceptions.
if (typeof document.elementFromPoint === "undefined") {
  document.elementFromPoint = () => null;
}

// Labels come from the key; a count keeps the numbers it interpolates.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${Object.values(options).join("/")}` : key,
    i18n: { language: "en", changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

// The shared rich-text factory includes the worker-backed spell-check extension,
// which jsdom cannot instantiate. Replace it with a no-op for these DOM tests.
vi.mock("../../../../components/editor/extensions/SpellCheck", async () => {
  const { Extension } = await vi.importActual<typeof import("@tiptap/core")>("@tiptap/core");
  return { SpellCheck: Extension.create({ name: "mockSpellCheck" }) };
});

describe("QuickNoteEditor", () => {
  beforeEach(() => {
    useSettingsStore.setState({ editorAutoClose: true });
  });

  it("renders a writing canvas with the formatting toolbar hidden by default", async () => {
    const { container } = render(<QuickNoteEditor onChange={vi.fn()} />);

    await waitFor(() => {
      expect(container.querySelector(".editor-content")).not.toBeNull();
    });

    expect(screen.queryByRole("button", { name: "editor.bold" })).not.toBeInTheDocument();
  });

  it("reveals the formatting toolbar when the advanced button is toggled", async () => {
    const { container } = render(<QuickNoteEditor onChange={vi.fn()} />);

    await waitFor(() => {
      expect(container.querySelector(".editor-content")).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "bookNotes.formatting" }));

    expect(screen.getByRole("button", { name: "editor.bold" })).toBeInTheDocument();
  });

  it("offers H1, H3 and task list controls in the advanced toolbar", async () => {
    const { container } = render(<QuickNoteEditor onChange={vi.fn()} />);

    await waitFor(() => {
      expect(container.querySelector(".editor-content")).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "bookNotes.formatting" }));

    expect(screen.getByRole("button", { name: "editor.heading1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "editor.heading3" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "editor.taskList" })).toBeInTheDocument();
  });

  it("autocloses pairs when the editor setting is enabled", async () => {
    const user = userEvent.setup();
    const { container } = render(<QuickNoteEditor onChange={vi.fn()} />);
    const editor = (await waitFor(() => {
      const el = container.querySelector("[contenteditable='true']");
      expect(el).not.toBeNull();
      return el as HTMLElement;
    })) as HTMLElement;

    await user.click(editor);
    await user.type(editor, "(");

    expect(editor).toHaveTextContent("()");
  });

  it("marks its content with the Book's language", async () => {
    useSettingsStore.setState({ language: "en" });
    const { container } = render(<QuickNoteEditor onChange={vi.fn()} bookLanguage="pt-BR" />);

    const editor = await waitFor(() => {
      const el = container.querySelector("[contenteditable='true']");
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });

    expect(editor.getAttribute("lang")).toBe("pt-BR");
  });

  it("marks its content with the app language when the Book has none", async () => {
    useSettingsStore.setState({ language: "es" });
    const { container } = render(<QuickNoteEditor onChange={vi.fn()} />);

    const editor = await waitFor(() => {
      const el = container.querySelector("[contenteditable='true']");
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });

    expect(editor.getAttribute("lang")).toBe("es");
  });

  describe("Opening Marks", () => {
    async function typeInto(bookLanguage: string | undefined, text: string) {
      const user = userEvent.setup();
      const { container } = render(
        <QuickNoteEditor onChange={vi.fn()} bookLanguage={bookLanguage} />
      );
      const editor = await waitFor(() => {
        const el = container.querySelector("[contenteditable='true']");
        expect(el).not.toBeNull();
        return el as HTMLElement;
      });
      await user.click(editor);
      await user.type(editor, text);
      return editor;
    }

    beforeEach(() => {
      useSettingsStore.setState({ editorAutoClose: false, language: "en" });
    });

    it("adds ¿ in a Spanish Book's Note when the setting is on", async () => {
      useSettingsStore.setState({ editorOpeningMarks: true });

      const editor = await typeInto("es", "Hola. Vienes?");

      expect(editor).toHaveTextContent("Hola. ¿Vienes?");
    });

    it("leaves an English Book's Note alone", async () => {
      useSettingsStore.setState({ editorOpeningMarks: true });

      const editor = await typeInto("en", "Vienes?");

      expect(editor).toHaveTextContent(/^Vienes\?$/);
    });

    it("follows the app language when there is no Book language", async () => {
      useSettingsStore.setState({ editorOpeningMarks: true, language: "es" });

      const editor = await typeInto(undefined, "Vienes?");

      expect(editor).toHaveTextContent("¿Vienes?");
    });

    it("does nothing while the setting is off", async () => {
      useSettingsStore.setState({ editorOpeningMarks: false });

      const editor = await typeInto("es", "Vienes?");

      expect(editor).toHaveTextContent(/^Vienes\?$/);
    });

    it("applies a setting turned on while the editor is open", async () => {
      useSettingsStore.setState({ editorOpeningMarks: false });
      const editor = await typeInto("es", "Vienes?");

      useSettingsStore.setState({ editorOpeningMarks: true });
      await userEvent.setup().type(editor, " Qué tal!");

      expect(editor).toHaveTextContent("Vienes? ¡Qué tal!");
    });
  });

  it("Escape leaves the editor so focus can reach the controls after it", async () => {
    const onEscape = vi.fn();
    const { container } = render(<QuickNoteEditor onChange={vi.fn()} onEscape={onEscape} />);
    const editor = await waitFor(() => {
      const el = container.querySelector("[contenteditable='true']");
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    editor.focus();

    fireEvent.keyDown(editor, { key: "Escape" });

    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it("keeps Escape inside the editor so an enclosing panel does not also dismiss", async () => {
    const onEscape = vi.fn();
    const onAncestorKeyDown = vi.fn();
    const { container } = render(
      <div onKeyDown={onAncestorKeyDown}>
        <QuickNoteEditor onChange={vi.fn()} onEscape={onEscape} />
      </div>
    );
    const editor = await waitFor(() => {
      const el = container.querySelector("[contenteditable='true']");
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    editor.focus();

    fireEvent.keyDown(editor, { key: "Escape" });

    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(onAncestorKeyDown).not.toHaveBeenCalled();
  });

  describe("shared editor surface", () => {
    beforeEach(() => {
      useModalStore.setState({ modalIds: [], openCount: 0, closers: {} });
      useTutorialStore.setState({ status: "idle" });
      useSearchSwitchesStore.setState({ matchCase: false, wholeWord: false, regex: false });
      useSettingsStore.setState({ spellCheckEnabled: true, language: "en", editorAutoClose: true });
      const focused = lastFocusedEditor();
      if (focused) forgetEditor(focused);
    });

    async function renderFocusedNote() {
      const onChange = vi.fn();
      const result = render(<QuickNoteEditor onChange={onChange} />);
      const editor = await waitFor(() => {
        const el = result.container.querySelector<HTMLElement>("[contenteditable='true']");
        expect(el).not.toBeNull();
        return el as HTMLElement;
      });
      await userEvent.setup().click(editor);
      return { ...result, editor, onChange };
    }

    it("runs the palette's formatting Commands against the note", async () => {
      const { editor } = await renderFocusedNote();

      const outcome = await runCommand("editor.horizontalRule", { source: "palette" });

      expect(outcome).toBe("ran");
      await waitFor(() => expect(editor.querySelector("hr")).not.toBeNull());
    });

    it("opens the Footnote dialog on Mod+Alt+N", async () => {
      const user = userEvent.setup();
      const { editor } = await renderFocusedNote();

      await user.click(editor);
      await user.keyboard("{Control>}{Alt>}n{/Alt}{/Control}");

      expect(await screen.findByRole("dialog", { name: "editor.footnote" })).toBeInTheDocument();
    });

    it("toggles Spell Check from the palette", async () => {
      await renderFocusedNote();
      expect(useSettingsStore.getState().spellCheckEnabled).toBe(true);

      const outcome = await runCommand("editor.spellCheck", { source: "palette" });

      expect(outcome).toBe("ran");
      expect(useSettingsStore.getState().spellCheckEnabled).toBe(false);
    });

    it("finds text in the note and returns focus to it on Escape", async () => {
      const user = userEvent.setup();
      const { editor } = await renderFocusedNote();
      await user.type(editor, "hello world");

      await user.keyboard("{Control>}f{/Control}");
      const find = await screen.findByPlaceholderText("editor.find");
      await waitFor(() => expect(find).toHaveFocus());

      await user.type(find, "world");
      expect(await screen.findByText("editor.matchesOf:1/1")).toBeInTheDocument();

      await user.keyboard("{Escape}");
      await waitFor(() =>
        expect(screen.queryByPlaceholderText("editor.find")).not.toBeInTheDocument()
      );
      await waitFor(() => expect(editor).toHaveFocus());
    });

    it("opens the Link dialog on Mod+K and returns focus to the note on Escape", async () => {
      const user = userEvent.setup();
      const { editor } = await renderFocusedNote();

      await user.click(editor);
      await user.keyboard("{Control>}k{/Control}");
      expect(await screen.findByRole("dialog", { name: "editor.insertLink" })).toBeInTheDocument();

      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      await waitFor(() => expect(editor).toHaveFocus());
    });

    it("opens the Symbols dialog from the palette and returns focus to the note on Escape", async () => {
      const user = userEvent.setup();
      const { editor } = await renderFocusedNote();

      expect(await runCommand("editor.insertSymbol", { source: "palette" })).toBe("ran");
      expect(await screen.findByRole("dialog", { name: "symbols.title" })).toBeInTheDocument();

      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      await waitFor(() => expect(editor).toHaveFocus());
    });

    it("increases the first-line indent and restores it on decrease", async () => {
      const { editor } = await renderFocusedNote();
      const before = editor.innerHTML;

      expect(await runCommand("editor.increaseFirstLineIndent", { source: "palette" })).toBe("ran");
      await waitFor(() => expect(editor.innerHTML).toContain("text-indent"));

      expect(await runCommand("editor.decreaseFirstLineIndent", { source: "palette" })).toBe("ran");
      await waitFor(() => expect(editor.innerHTML).toBe(before));
    });

    it("opens the Image dialog from the palette", async () => {
      await renderFocusedNote();

      expect(await runCommand("editor.insertImage", { source: "palette" })).toBe("ran");
      expect(await screen.findByRole("dialog", { name: "editor.insertImage" })).toBeInTheDocument();
    });

    it("opens the dictionary prompt from the palette when nothing is selected", async () => {
      await renderFocusedNote();

      expect(await runCommand("editor.dictionary", { source: "palette" })).toBe("ran");
      expect(
        await screen.findByRole("dialog", { name: "dictionary.promptTitle" })
      ).toBeInTheDocument();
    });

    it("colors the selected text from the palette", async () => {
      const user = userEvent.setup();
      const { editor } = await renderFocusedNote();
      await user.type(editor, "hello");

      lastFocusedEditor()!.commands.setTextSelection({ from: 1, to: 6 });

      expect(await runCommand("editor.textColor", { source: "palette" })).toBe("ran");
      await waitFor(() => expect(editor.innerHTML).toContain("rgb(0, 0, 0)"));
    });

    it("toggles Match case with Alt+C from the open Find field", async () => {
      const user = userEvent.setup();
      const { editor } = await renderFocusedNote();
      await user.type(editor, "hello world");

      await user.keyboard("{Control>}f{/Control}");
      const find = await screen.findByPlaceholderText("editor.find");
      await waitFor(() => expect(find).toHaveFocus());

      await user.keyboard("{Alt>}c{/Alt}");

      expect(useSearchSwitchesStore.getState().matchCase).toBe(true);
    });
  });
});
