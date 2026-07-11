import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ResponsiveEditorToolbar } from "@/components/editor/toolbar/ResponsiveEditorToolbar";
import type { ToolbarGroupCallbacks } from "@/components/editor/toolbar/EditorToolbarGroups";
import { useSettingsStore } from "@/features/settings/store";
import type { ToolbarConfig } from "@/features/settings/toolbar-config";
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

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    disconnect() {}
    unobserve() {}
  },
);
vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
  cb(0);
  return 0;
});

let mockVisibleCount = 1;

vi.mock("@/components/editor/toolbar/useToolbarOverflow", () => ({
  useToolbarOverflow: () => ({ visibleCount: mockVisibleCount }),
}));

const callbacks: ToolbarGroupCallbacks = {
  spellCheckLanguage: "en",
  onSpellCheckLanguageChange: () => {},
  openFindReplace: () => {},
  isFindReplaceOpen: false,
  onToggleFindReplace: () => {},
  openImageDialog: () => {},
  openFootnote: () => {},
  openLinkDialog: () => {},
  openDictionary: () => {},
  openHtmlPanel: () => {},
};

const TWO_START_ONE_END_CONFIG: ToolbarConfig = {
  start: [
    { kind: "group", id: "history", toolbarVisible: true, floatingVisible: false },
    { kind: "group", id: "font", toolbarVisible: true, floatingVisible: false },
  ],
  end: [
    { kind: "group", id: "export", toolbarVisible: true, floatingVisible: false },
  ],
};

beforeEach(() => {
  mockVisibleCount = 1;
  useSettingsStore.setState({
    toolbarConfig: TWO_START_ONE_END_CONFIG,
    toolbarExpanded: false,
  });
});

function renderToolbar() {
  return render(
    <ResponsiveEditorToolbar
      editor={makeToolbarEditor()}
      callbacks={callbacks}
      fixedUtilities={<div>fixed</div>}
      utilityCluster={<div>utils</div>}
    />,
  );
}

it("collapsed: hides overflowing Start groups but always keeps End groups and utilities", () => {
  const { getByTestId } = renderToolbar();
  const startLane = getByTestId("toolbar-start-lane");
  const endLane = getByTestId("toolbar-end-lane");

  expect(startLane.querySelector('[data-group-id="history"]')).toBeInTheDocument();
  expect(startLane.querySelector('[data-group-id="font"]')).not.toBeInTheDocument();
  expect(endLane.querySelector('[data-group-id="export"]')).toBeInTheDocument();
  expect(screen.getByText("fixed")).toBeInTheDocument();
  expect(screen.getByText("utils")).toBeInTheDocument();
});

it("expanded: renders every visible Start and End group regardless of visibleCount", () => {
  useSettingsStore.setState({ toolbarExpanded: true });
  const { getByTestId } = renderToolbar();
  const startLane = getByTestId("toolbar-start-lane");
  const endLane = getByTestId("toolbar-end-lane");

  expect(startLane.querySelector('[data-group-id="history"]')).toBeInTheDocument();
  expect(startLane.querySelector('[data-group-id="font"]')).toBeInTheDocument();
  expect(endLane.querySelector('[data-group-id="export"]')).toBeInTheDocument();
  expect(screen.getByText("fixed")).toBeInTheDocument();
  expect(screen.getByText("utils")).toBeInTheDocument();
});

it("suppresses a leading divider at the Start lane boundary", () => {
  mockVisibleCount = 5;
  useSettingsStore.setState({
    toolbarConfig: {
      start: [
        { kind: "divider", id: "d1" },
        { kind: "group", id: "history", toolbarVisible: true, floatingVisible: false },
      ],
      end: [],
    },
  });
  const { getByTestId } = renderToolbar();
  const startLane = getByTestId("toolbar-start-lane");

  expect(startLane.querySelector('[data-group-id="history"]')).toBeInTheDocument();
  expect(startLane.querySelectorAll(".w-px.h-6.bg-border").length).toBe(0);
});
