import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QuickNoteEditor } from "@/components/book/QuickNoteEditor";
import { useSettingsStore } from "@/features/settings/store";

// jsdom does not implement elementFromPoint, which ProseMirror calls during
// mousedown handling. Polyfill it to avoid uncaught exceptions.
if (typeof document.elementFromPoint === "undefined") {
  document.elementFromPoint = () => null;
}

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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
});
