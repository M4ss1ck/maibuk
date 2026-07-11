import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  EditorToolbarGroups,
  type ToolbarGroupCallbacks,
} from "@/components/editor/toolbar/EditorToolbarGroups";
import { makeToolbarEditor } from "@/test/support/toolbar-editor";
import { ALL_GROUP_IDS } from "@/features/settings/toolbar-config";

vi.mock("@tiptap/react", () => ({
  useEditorState: ({ editor, selector }: { editor: unknown; selector: (value: { editor: unknown }) => unknown }) =>
    selector({ editor }),
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

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
  openHtmlPanel: vi.fn(),
};

describe("EditorToolbarGroups", () => {
  it("renders only requested groups and keeps export buttons mounted", () => {
    render(
      <EditorToolbarGroups
        editor={makeToolbarEditor()}
        groupIds={["basic-marks", "export"]}
        callbacks={callbacks}
      />,
    );
    expect(screen.getByLabelText("editor.bold")).toBeInTheDocument();
    expect(screen.queryByLabelText("editor.undo")).not.toBeInTheDocument();
    expect(screen.getByLabelText("editor.exportMarkdown")).toBeDisabled();
    expect(screen.getByLabelText("editor.exportPdf")).toBeDisabled();
    expect(screen.getByLabelText("editor.exportImage")).toBeDisabled();
  });

  it("keeps the task-list button mounted and disabled when schema support is absent", () => {
    render(
      <EditorToolbarGroups
        editor={makeToolbarEditor()}
        groupIds={["lists"]}
        callbacks={callbacks}
      />,
    );
    expect(screen.getByLabelText("editor.taskList")).toBeDisabled();
  });

  it("renders the stable table group", () => {
    render(
      <EditorToolbarGroups
        editor={makeToolbarEditor()}
        groupIds={["table"]}
        callbacks={callbacks}
      />,
    );
    expect(screen.getByLabelText("editor.insertTable")).toBeInTheDocument();
  });

  it("wraps each requested group in a measurable boundary", () => {
    const { container } = render(
      <EditorToolbarGroups
        editor={makeToolbarEditor()}
        groupIds={["history", "font"]}
        callbacks={callbacks}
      />,
    );
    expect(container.querySelectorAll("[data-group-id]")).toHaveLength(2);
  });

  it("renders every canonical group case", () => {
    const { container } = render(
      <EditorToolbarGroups
        editor={makeToolbarEditor({ taskList: true })}
        groupIds={[...ALL_GROUP_IDS]}
        callbacks={callbacks}
      />,
    );
    expect(container.querySelectorAll("[data-group-id]")).toHaveLength(
      ALL_GROUP_IDS.length,
    );
  });
});
