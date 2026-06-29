import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Editor } from "@/components/editor/Editor";
import { TaskItem, TaskList } from "@tiptap/extension-list";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("../../../../features/settings/store", () => ({
  useSettingsStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ spellCheckEnabled: false, language: "en" }),
}));

vi.mock("../../../../features/metrics/programmatic", () => ({
  setContentSilently: vi.fn(),
}));

vi.mock("../../../../components/editor/EditorToolbar", () => ({ EditorToolbar: () => null }));
vi.mock("../../../../components/editor/SelectionToolbar", () => ({ SelectionToolbar: () => null }));
vi.mock("../../../../components/editor/LinkClickHandler", () => ({ LinkClickHandler: () => null }));
vi.mock("../../../../components/editor/LinkDialog", () => ({ LinkDialog: () => null }));
vi.mock("../../../../components/editor/ImageContextMenu", () => ({ ImageContextMenu: () => null }));
vi.mock("../../../../components/editor/FootnoteList", () => ({ FootnoteList: () => null }));
vi.mock("../../../../components/editor/extensions/SpellCheck", async () => {
  const { Extension } = await vi.importActual<typeof import("@tiptap/core")>("@tiptap/core");
  return { SpellCheck: Extension.create({ name: "mockSpellCheck" }) };
});

describe("Editor tasklist DOM", () => {
  it("renders task items with stable data attributes", async () => {
    const { container } = render(
      <Editor
        content={`<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>item 1</p></li></ul>`}
        onUpdate={vi.fn()}
        extraExtensions={[
          TaskList,
          TaskItem.configure({ nested: true, HTMLAttributes: { draggable: "true" } }),
        ]}
      />
    );

    await waitFor(() => {
      const taskList = container.querySelector(".editor-content ul[data-type='taskList']");
      expect(taskList).not.toBeNull();
    });

    const taskItem = container.querySelector(".editor-content ul[data-type='taskList'] li");
    expect(taskItem?.getAttribute("data-checked")).toBe("false");
    expect((taskItem as HTMLLIElement | null)?.draggable).toBe(true);
  });
});
