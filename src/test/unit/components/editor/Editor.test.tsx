import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "../../../../components/editor/Editor";

const { mockSetContentSilently } = vi.hoisted(() => ({
  mockSetContentSilently: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("../../../../features/settings/store", () => ({
  useSettingsStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      spellCheckEnabled: false,
      language: "en",
    }),
}));

vi.mock("../../../../features/metrics/programmatic", () => ({
  setContentSilently: mockSetContentSilently,
}));

vi.mock("../../../../components/editor/EditorToolbar", () => ({
  EditorToolbar: () => null,
}));

vi.mock("../../../../components/editor/SelectionToolbar", () => ({
  SelectionToolbar: () => null,
}));

vi.mock("../../../../components/editor/LinkClickHandler", () => ({
  LinkClickHandler: () => null,
}));

vi.mock("../../../../components/editor/LinkDialog", () => ({
  LinkDialog: () => null,
}));

vi.mock("../../../../components/editor/ImageContextMenu", () => ({
  ImageContextMenu: () => null,
}));

vi.mock("../../../../components/editor/FootnoteList", () => ({
  FootnoteList: () => null,
}));

vi.mock("../../../../components/editor/extensions/SpellCheck", async () => {
  const { Extension } = await vi.importActual<typeof import("@tiptap/core")>(
    "@tiptap/core",
  );
  return {
    SpellCheck: Extension.create({ name: "mockSpellCheck" }),
  };
});

describe("Editor", () => {
  beforeEach(() => {
    mockSetContentSilently.mockClear();
  });

  it("does not re-apply initial content after the editor is created", async () => {
    render(
      <Editor
        content={"<p>Loaded chapter</p>\n"}
        onUpdate={vi.fn()}
        onWordCountChange={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(mockSetContentSilently).not.toHaveBeenCalled();
    });
  });
});
