import { afterEach, describe, expect, it, vi } from "vitest";
import { useBoundShortcutStore } from "@/lib/bound-shortcuts";
import { useSearchSwitchesStore } from "@/features/search/switches";
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

// jsdom cannot scroll: the panel scrolls the active match into view.
Element.prototype.scrollIntoView ??= function scrollIntoView() {};

const editors: Editor[] = [];

function renderFindReplace(onClose: () => void, content = "") {
  const editor = new Editor({
    content,
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
  useSearchSwitchesStore.setState({ matchCase: false, wholeWord: false, regex: false });
  for (const editor of editors.splice(0)) editor.destroy();
});

describe("FindReplace", () => {
  it("lists its switch Shortcuts as bound while open", () => {
    const { unmount } = renderFindReplace(() => {});

    expect(Object.keys(useBoundShortcutStore.getState().counts)).toEqual(
      expect.arrayContaining(["common.matchCase", "common.wholeWord", "common.useRegex"])
    );

    unmount();
    expect(Object.keys(useBoundShortcutStore.getState().counts)).not.toContain("common.matchCase");
  });

  it("re-runs the search when Alt+C flips Match case", async () => {
    const user = userEvent.setup();
    const { unmount } = renderFindReplace(() => {}, "<p>The cat sat on the Cat</p>");

    const find = screen.getByPlaceholderText("editor.find");
    await user.click(find);
    await user.keyboard("cat");
    await waitFor(() => expect(document.querySelectorAll(".search-result")).toHaveLength(2));

    await user.keyboard("{Alt>}c{/Alt}");
    await waitFor(() =>
      expect(document.querySelectorAll(".search-result")).toHaveLength(1)
    );
    expect(useSearchSwitchesStore.getState().matchCase).toBe(true);
    // The switch key never reaches the field as text.
    expect(find).toHaveValue("cat");
    unmount();
  });

  it("toggles Match case back off from its button", async () => {
    const user = userEvent.setup();
    const { unmount } = renderFindReplace(() => {}, "<p>The cat sat on the Cat</p>");

    await user.click(screen.getByPlaceholderText("editor.find"));
    await user.keyboard("cat");
    await waitFor(() => expect(document.querySelectorAll(".search-result")).toHaveLength(2));

    await user.keyboard("{Alt>}c{/Alt}");
    await waitFor(() => expect(document.querySelectorAll(".search-result")).toHaveLength(1));

    await user.click(screen.getByRole("button", { name: "editor.matchCase" }));
    await waitFor(() => expect(document.querySelectorAll(".search-result")).toHaveLength(2));
    expect(useSearchSwitchesStore.getState().matchCase).toBe(false);
    unmount();
  });

  it("re-runs the search when Alt+W flips Whole word", async () => {
    const user = userEvent.setup();
    const { unmount } = renderFindReplace(() => {}, "<p>cat cats concatenate</p>");

    await user.click(screen.getByPlaceholderText("editor.find"));
    await user.keyboard("cat");
    await waitFor(() => expect(document.querySelectorAll(".search-result")).toHaveLength(3));

    await user.keyboard("{Alt>}w{/Alt}");
    await waitFor(() => expect(document.querySelectorAll(".search-result")).toHaveLength(1));
    expect(useSearchSwitchesStore.getState().wholeWord).toBe(true);
    unmount();
  });

  it("re-runs the search when Alt+R flips Regex", async () => {
    const user = userEvent.setup();
    const { unmount } = renderFindReplace(() => {}, "<p>cat cot cut dog</p>");

    await user.click(screen.getByPlaceholderText("editor.find"));
    await user.keyboard("c.t");
    await waitFor(() => expect(document.querySelectorAll(".search-result")).toHaveLength(0));

    await user.keyboard("{Alt>}r{/Alt}");
    await waitFor(() => expect(document.querySelectorAll(".search-result")).toHaveLength(3));
    expect(useSearchSwitchesStore.getState().regex).toBe(true);
    unmount();
  });

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
