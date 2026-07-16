import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  EditorToolbarGroups,
  type ToolbarGroupCallbacks,
} from "@/components/editor/toolbar/EditorToolbarGroups";
import { makeToolbarEditor } from "@/test/support/toolbar-editor";

vi.mock("@tiptap/react", () => ({
  useEditorState: ({
    editor,
    selector,
  }: {
    editor: unknown;
    selector: (value: { editor: unknown }) => unknown;
  }) => selector({ editor }),
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

function makeCallbacks(overrides: Partial<ToolbarGroupCallbacks> = {}): ToolbarGroupCallbacks {
  return {
    spellCheckLanguage: "en",
    onSpellCheckLanguageChange: vi.fn(),
    openFindReplace: vi.fn(),
    isFindReplaceOpen: false,
    onToggleFindReplace: vi.fn(),
    openImageDialog: vi.fn(),
    openFootnote: vi.fn(),
    openLinkDialog: vi.fn(),
    openDictionary: vi.fn(),
    openHtmlPanel: vi.fn(),
    ...overrides,
  };
}

describe("EditorToolbarGroups dictionary button", () => {
  it("stays enabled and invokes openDictionary when there is no selection", () => {
    const openDictionary = vi.fn();
    render(
      <EditorToolbarGroups
        editor={makeToolbarEditor()}
        groupIds={["dictionary"]}
        callbacks={makeCallbacks({ openDictionary })}
      />
    );

    const button = screen.getByLabelText("editor.dictionary");
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(openDictionary).toHaveBeenCalledTimes(1);
  });
});
