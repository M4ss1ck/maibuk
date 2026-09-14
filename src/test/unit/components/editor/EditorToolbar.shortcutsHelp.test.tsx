import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Editor } from "@tiptap/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditorToolbar } from "@/components/editor/EditorToolbar";
import { useModalStore } from "@/components/ui/modal-store";
import { useSettingsStore } from "@/features/settings/store";

// This suite uses the REAL useShortcuts, bound-shortcut store, ShortcutsHelpDialog,
// Modal and modal-store: the help lists what the toolbar binds, even though the
// help is itself a modal. Only the heavy, unrelated toolbar internals are mocked.

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
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
  it("lists the toolbar's bound shortcuts, opened and closed from the keyboard", async () => {
    const user = userEvent.setup();
    renderToolbar();
    const trigger = screen.getByRole("button", { name: "shortcuts.title" });

    trigger.focus();
    await user.keyboard("{Enter}");

    const dialog = await screen.findByRole("dialog");
    const thisScreen = within(dialog).getByRole("region", { name: "shortcuts.onThisScreen" });
    expect(within(thisScreen).getByText("editor.findReplace")).toBeInTheDocument();
    expect(within(thisScreen).getByText("editor.dictionary")).toBeInTheDocument();
    expect(within(thisScreen).getByText("shortcuts.insertSymbol")).toBeInTheDocument();
    // Ctrl+K is handled by the toolbar's editor key listener, and declared as bound.
    expect(within(thisScreen).getByText("editor.insertLink")).toBeInTheDocument();
    // Saving belongs to the page, which is not mounted here.
    expect(within(thisScreen).queryByText("shortcuts.save")).not.toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
