import { fireEvent, render, screen } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditorToolbar } from "@/components/editor/EditorToolbar";
import { useModalStore } from "@/components/ui/modal-store";
import { useSettingsStore } from "@/features/settings/store";

// This suite uses the REAL useActiveShortcuts, ShortcutsHelpDialog, Modal and
// modal-store so that opening the help dialog (which is itself a modal) exercises
// the interaction that caused the bug: useActiveShortcuts returns [] while a modal
// is open. Only the heavy, unrelated toolbar internals are mocked.

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/lib/shortcuts", () => ({
  useShortcuts: () => {},
}));

vi.mock("@/components/editor/toolbar/ResponsiveEditorToolbar", () => ({
  ResponsiveEditorToolbar: ({
    utilityCluster,
    fixedUtilities,
  }: {
    utilityCluster: ReactNode;
    fixedUtilities: ReactNode;
  }) => (
    <div>
      {utilityCluster}
      {fixedUtilities}
    </div>
  ),
}));

vi.mock("@/components/editor/ZoomControl", () => ({
  ZoomControl: () => <button type="button">zoom utility</button>,
}));
vi.mock("@/components/editor/WidthControl", () => ({
  WidthControl: () => <button type="button">width utility</button>,
}));
vi.mock("@/components/editor/FindReplace", () => ({ FindReplace: () => null }));
vi.mock("@/components/editor/ImageInsertDialog", () => ({ ImageInsertDialog: () => null }));
vi.mock("@/components/editor/FootnoteDialog", () => ({ FootnoteDialog: () => null }));
vi.mock("@/components/editor/LinkDialog", () => ({ LinkDialog: () => null }));
vi.mock("@/components/editor/HtmlViewPanel", () => ({ HtmlViewPanel: () => null }));
vi.mock("@/components/editor/DictionaryDialog", () => ({ DictionaryDialog: () => null }));
vi.mock("@/components/editor/DictionaryPromptDialog", () => ({
  DictionaryPromptDialog: () => null,
}));
vi.mock("@/components/editor/SymbolsDialog", () => ({ SymbolsDialog: () => null }));
vi.mock("@/components/editor/EditorContextMenu", () => ({ EditorContextMenu: () => null }));
vi.mock("@/components/editor/toolbar/ToolbarSettingsDialog", () => ({
  ToolbarSettingsDialog: () => null,
}));

function makeEditor() {
  const dom = document.createElement("div");
  return {
    view: { dom },
    state: {
      selection: { from: 0, to: 0 },
      doc: { textBetween: () => "" },
    },
    commands: { setSpellCheckLanguage: vi.fn() },
    getHTML: () => "<p>Text</p>",
  } as unknown as Editor;
}

function renderToolbar() {
  render(
    <MemoryRouter initialEntries={["/book/test-book"]}>
      <EditorToolbar editor={makeEditor()} spellCheckLanguage="en" />
    </MemoryRouter>
  );
}

beforeEach(() => {
  useModalStore.setState({ modalIds: [], openCount: 0 });
  useSettingsStore.setState({
    toolbarExpanded: false,
    showNotesChapter: false,
    bookSidePanelTab: "notes",
    dictionaryOpenInBrowser: false,
  });
});

describe("EditorToolbar shortcuts help", () => {
  it("lists the active shortcuts in the help dialog even though the dialog is a modal", async () => {
    renderToolbar();

    fireEvent.click(screen.getByRole("button", { name: "shortcuts.title" }));

    // The book route exposes the Save shortcut (labelKey "shortcuts.save").
    expect(await screen.findByText("shortcuts.save")).toBeInTheDocument();
    // The new dictionary shortcut is included too.
    expect(screen.getByText("editor.dictionary")).toBeInTheDocument();
    // The empty-state message must not be shown.
    expect(screen.queryByText("shortcuts.none")).not.toBeInTheDocument();
  });
});
