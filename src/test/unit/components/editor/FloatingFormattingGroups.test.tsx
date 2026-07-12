import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { FloatingFormattingGroups } from "@/components/editor/toolbar/FloatingFormattingGroups";
import {
  DEFAULT_TOOLBAR_CONFIG,
  setGroupFloatingVisible,
} from "@/features/settings/toolbar-config";
import { useSettingsStore } from "@/features/settings/store";
import { makeToolbarEditor } from "@/test/support/toolbar-editor";

vi.mock("@tiptap/react", () => ({
  useEditorState: ({ editor, selector }: { editor: unknown; selector: (value: { editor: unknown }) => unknown }) =>
    selector({ editor }),
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

beforeEach(() => {
  useSettingsStore.setState({ toolbarConfig: DEFAULT_TOOLBAR_CONFIG });
});

it("renders floating-eligible visible groups in Start-then-End order", () => {
  render(
    <FloatingFormattingGroups
      editor={makeToolbarEditor()}
      onLinkClick={vi.fn()}
    />,
  );
  expect(screen.getByLabelText("editor.bold")).toBeInTheDocument();
  expect(screen.getByLabelText("editor.heading1")).toBeInTheDocument();
  expect(screen.getByLabelText("editor.highlight")).toBeInTheDocument();
  expect(screen.getByLabelText("editor.insertLink")).toBeInTheDocument();
  expect(screen.queryByLabelText("editor.undo")).not.toBeInTheDocument();
});

it("returns null when every floating group is disabled", () => {
  let config = DEFAULT_TOOLBAR_CONFIG;
  for (const id of [
    "basic-marks",
    "headings",
    "highlight",
    "link-code",
  ] as const) {
    config = setGroupFloatingVisible(config, id, false);
  }
  useSettingsStore.setState({ toolbarConfig: config });
  const { container } = render(
    <FloatingFormattingGroups
      editor={makeToolbarEditor()}
      onLinkClick={vi.fn()}
    />,
  );
  expect(container).toBeEmptyDOMElement();
});
