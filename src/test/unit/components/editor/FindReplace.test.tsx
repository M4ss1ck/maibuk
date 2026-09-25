import { afterEach, describe, expect, it, vi } from "vitest";
import { useBoundShortcutStore } from "@/lib/bound-shortcuts";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { createRichTextExtensions } from "@/components/editor/extensions/createRichTextExtensions";
import { SearchReplace } from "@/components/editor/extensions/SearchReplace";
import { FindReplace } from "@/components/editor/FindReplace";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const editors: Editor[] = [];

function renderFindReplace(onClose: () => void) {
  const editor = new Editor({
    extensions: [...createRichTextExtensions(), SearchReplace],
  });
  editors.push(editor);
  const result = render(
    <div>
      <EditorContent editor={editor} />
      <FindReplace editor={editor} isOpen onClose={onClose} />
    </div>
  );
  return { editor, ...result };
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe("FindReplace", () => {
  it("lists its Enter, Shift+Enter and Escape keys as bound while open", () => {
    const { unmount } = renderFindReplace(() => {});

    expect(Object.keys(useBoundShortcutStore.getState().counts)).toEqual(
      expect.arrayContaining(["editor.findNext", "editor.findPrevious", "editor.closeFindReplace"])
    );

    unmount();
    expect(Object.keys(useBoundShortcutStore.getState().counts)).not.toContain("editor.findNext");
  });

  it("closes with Escape from the find input", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderFindReplace(onClose);

    await user.click(screen.getByPlaceholderText("editor.find"));
    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes with Escape from the replace input", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderFindReplace(onClose);

    await user.click(screen.getByPlaceholderText("editor.replaceWith"));
    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("hands focus back to the editor when Escape closes it", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { editor } = renderFindReplace(onClose);

    await user.click(screen.getByPlaceholderText("editor.find"));
    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(document.activeElement).toBe(editor.view.dom));
  });

  it("sizes inputs from available panel width instead of fixed 224px, keeping every action", () => {
    const onClose = vi.fn();
    renderFindReplace(onClose);

    const findInput = screen.getByPlaceholderText("editor.find");
    expect(findInput).not.toHaveClass("w-56");
    expect(findInput).toHaveClass("w-full");

    const replaceInput = screen.getByPlaceholderText("editor.replaceWith");
    expect(replaceInput).not.toHaveClass("w-56");
    expect(replaceInput).toHaveClass("flex-1");

    const panel = findInput.closest(".absolute");
    expect(panel).not.toBeNull();
    expect(panel).toHaveClass("w-[min(28rem,calc(100%_-_1rem))]");

    for (const label of [
      "editor.findPrevious",
      "editor.findNext",
      "editor.closeFindReplace",
      "editor.replace",
      "editor.replaceAll",
      "editor.matchCase",
      "editor.matchWholeWord",
      "editor.useRegex",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });
});
