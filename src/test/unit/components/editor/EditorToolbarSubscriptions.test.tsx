import { Editor } from "@tiptap/core";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Profiler } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRichTextExtensions } from "@/components/editor/extensions/createRichTextExtensions";
import {
  EditorToolbarGroups,
  type ToolbarGroupCallbacks,
} from "@/components/editor/toolbar/EditorToolbarGroups";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
const editors: Editor[] = [];
afterEach(() => {
  editors.splice(0).forEach((editor) => { editor.destroy(); });
});
const callbacks: ToolbarGroupCallbacks = {
  spellCheckLanguage: "en",
  onSpellCheckLanguageChange: vi.fn(),
  openFindReplace: vi.fn(),
  isFindReplaceOpen: false,
  onToggleFindReplace: vi.fn(),
  openImageDialog: vi.fn(),
  openFootnote: vi.fn(),
  openLinkDialog: vi.fn(),
  openDictionary: vi.fn(),
  openSymbols: vi.fn(),
  openHtmlPanel: vi.fn(),
};

function setup() {
  const editor = new Editor({ extensions: createRichTextExtensions(), content: "<p>Hello</p>" });
  editors.push(editor);
  const markRenders = vi.fn();
  render(
    <>
      <Profiler id="marks" onRender={markRenders}>
        <EditorToolbarGroups editor={editor} groupIds={["basic-marks"]} callbacks={callbacks} />
      </Profiler>
      <EditorToolbarGroups editor={editor} groupIds={["history"]} callbacks={callbacks} />
    </>
  );
  return { editor, markRenders };
}

describe("toolbar subscriptions", () => {
  it("updates Undo after the first keystroke without rendering unrelated formatting controls", () => {
    const { editor, markRenders } = setup();
    const renders = markRenders.mock.calls.length;
    expect(screen.getByLabelText("editor.undo")).toBeDisabled();
    act(() => {
      editor.commands.insertContent("!");
    });
    expect(screen.getByLabelText("editor.undo")).toBeEnabled();
    expect(markRenders).toHaveBeenCalledTimes(renders);
  });

  it("keeps keyboard formatting and undo/redo connected to the real editor", async () => {
    const user = userEvent.setup();
    const { editor } = setup();
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 6 });
    });
    screen.getByLabelText("editor.bold").focus();
    await user.keyboard("{Enter}");
    expect(editor.getHTML()).toContain("<strong>Hello</strong>");
    screen.getByLabelText("editor.undo").focus();
    await user.keyboard("{Enter}");
    expect(editor.getHTML()).not.toContain("<strong>");
    screen.getByLabelText("editor.redo").focus();
    await user.keyboard("{Enter}");
    expect(editor.getHTML()).toContain("<strong>Hello</strong>");
  });
});
