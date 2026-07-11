import { act, fireEvent, render, screen } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditorToolbar } from "@/components/editor/EditorToolbar";
import { useSettingsStore } from "@/features/settings/store";

interface ShortcutBinding {
  keys: string[];
  onTrigger: () => void;
}

const { shortcutBindings } = vi.hoisted(() => ({
  shortcutBindings: [] as ShortcutBinding[],
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/hooks", () => ({ useActiveShortcuts: () => [] }));

vi.mock("@/lib/shortcuts", () => ({
  useShortcuts: (bindings: ShortcutBinding[]) => {
    shortcutBindings.splice(0, shortcutBindings.length, ...bindings);
  },
}));

vi.mock("@/components/editor/toolbar/ResponsiveEditorToolbar", () => ({
  ResponsiveEditorToolbar: ({
    callbacks,
    utilityCluster,
    fixedUtilities,
  }: {
    callbacks: {
      openFindReplace: () => void;
      openImageDialog: () => void;
      openFootnote: () => void;
      openLinkDialog: () => void;
      openHtmlPanel: () => void;
    };
    utilityCluster: ReactNode;
    fixedUtilities: ReactNode;
  }) => (
    <div>
      <div data-testid="utility-order">
        {utilityCluster}
        {fixedUtilities}
      </div>
      <button type="button" onClick={callbacks.openFindReplace}>find callback</button>
      <button type="button" onClick={callbacks.openImageDialog}>image callback</button>
      <button type="button" onClick={callbacks.openFootnote}>footnote callback</button>
      <button type="button" onClick={callbacks.openLinkDialog}>link callback</button>
      <button type="button" onClick={callbacks.openHtmlPanel}>html callback</button>
    </div>
  ),
}));

vi.mock("@/components/editor/ZoomControl", () => ({
  ZoomControl: () => <button type="button">zoom utility</button>,
}));
vi.mock("@/components/editor/WidthControl", () => ({
  WidthControl: () => <button type="button">width utility</button>,
}));

vi.mock("@/components/editor/FindReplace", () => ({
  FindReplace: ({ isOpen }: { isOpen: boolean }) => isOpen ? <div>find dialog open</div> : null,
}));
vi.mock("@/components/editor/ImageInsertDialog", () => ({
  ImageInsertDialog: ({ isOpen }: { isOpen: boolean }) => isOpen ? <div>image dialog open</div> : null,
}));
vi.mock("@/components/editor/FootnoteDialog", () => ({
  FootnoteDialog: ({ isOpen }: { isOpen: boolean }) => isOpen ? <div>footnote dialog open</div> : null,
}));
vi.mock("@/components/editor/LinkDialog", () => ({
  LinkDialog: ({ isOpen }: { isOpen: boolean }) => isOpen ? <div>link dialog open</div> : null,
}));
vi.mock("@/components/editor/HtmlViewPanel", () => ({
  HtmlViewPanel: ({ isOpen }: { isOpen: boolean }) => isOpen ? <div>html panel open</div> : null,
}));
vi.mock("@/components/editor/DictionaryDialog", () => ({ DictionaryDialog: () => null }));
vi.mock("@/components/ShortcutsHelpDialog", () => ({ ShortcutsHelpDialog: () => null }));
vi.mock("@/components/editor/EditorContextMenu", () => ({ EditorContextMenu: () => null }));
vi.mock("@/components/editor/toolbar/ToolbarSettingsDialog", () => ({
  ToolbarSettingsDialog: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => isOpen ? (
    <div>
      toolbar settings open
      <button type="button" onClick={onClose}>close settings</button>
    </div>
  ) : null,
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
  const editor = makeEditor();
  render(<EditorToolbar editor={editor} spellCheckLanguage="en" />);
  return editor;
}

beforeEach(() => {
  shortcutBindings.length = 0;
  useSettingsStore.setState({
    toolbarExpanded: false,
    showNotesChapter: false,
    bookSidePanelTab: "notes",
    dictionaryOpenInBrowser: false,
  });
});

describe("EditorToolbar", () => {
  it("keeps shortcuts, divider, settings, width, zoom, and expand utilities in order", () => {
    renderToolbar();
    const cluster = screen.getByTestId("utility-order");
    const controls = Array.from(cluster.querySelectorAll("button")).map(
      (button) => button.getAttribute("aria-label") ?? button.textContent,
    );

    expect(controls).toEqual([
      "shortcuts.title",
      "toolbar.settings.open",
      "width utility",
      "zoom utility",
      "editor.showToolbar",
    ]);
    expect(cluster.children[1]).toHaveClass("w-px", "h-6", "bg-border");
  });

  it("opens toolbar settings from the gear and registered shortcut", () => {
    renderToolbar();
    fireEvent.click(screen.getByRole("button", { name: "toolbar.settings.open" }));
    expect(screen.getByText("toolbar settings open")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "close settings" }));
    expect(screen.queryByText("toolbar settings open")).not.toBeInTheDocument();
    const binding = shortcutBindings.find((item) => item.keys.includes("ctrl+shift+,"));
    expect(binding).toBeDefined();
    act(() => binding?.onTrigger());
    expect(screen.getByText("toolbar settings open")).toBeInTheDocument();
  });

  it.each([
    ["find callback", "find dialog open"],
    ["image callback", "image dialog open"],
    ["link callback", "link dialog open"],
    ["html callback", "html panel open"],
  ])("preserves the %s behavior", (callbackName, openContent) => {
    renderToolbar();
    fireEvent.click(screen.getByRole("button", { name: callbackName }));
    expect(screen.getByText(openContent)).toBeInTheDocument();
  });

  it("opens the footnote dialog when the editor had focus", () => {
    const editor = renderToolbar();
    fireEvent.focus(editor.view.dom);
    fireEvent.click(screen.getByRole("button", { name: "footnote callback" }));
    expect(screen.getByText("footnote dialog open")).toBeInTheDocument();
  });
});
