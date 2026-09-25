import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { HtmlViewPanel } from "@/components/editor/HtmlViewPanel";
import { createRichTextExtensions } from "@/components/editor/extensions/createRichTextExtensions";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

let capturedCodeMirrorOptions: {
  onDiagnosticsChange?: (count: number) => void;
} | null = null;

vi.mock("@/components/editor/useCodeMirror", () => ({
  useCodeMirror: (options: { onDiagnosticsChange?: (count: number) => void }) => {
    capturedCodeMirrorOptions = options;
    return { containerRef: { current: null }, isLoading: false, handle: null };
  },
}));

vi.mock("@/features/settings/store", () => {
  const state = {
    addPasteCleanupRule: vi.fn(),
    htmlPanelHeight: 200,
    setHtmlPanelHeight: vi.fn(),
    htmlEditorLightTheme: "default",
    htmlEditorDarkTheme: "default",
    setHtmlEditorLightTheme: vi.fn(),
    setHtmlEditorDarkTheme: vi.fn(),
  };
  return { useSettingsStore: (selector: (s: typeof state) => unknown) => selector(state) };
});

vi.mock("@/features/theme/store", () => ({
  useThemeStore: (selector: (s: { theme: string }) => unknown) => selector({ theme: "light" }),
}));

const editors: Editor[] = [];

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function renderPanel() {
  const editor = new Editor({
    extensions: createRichTextExtensions(),
    content: "<p>Body</p>",
  });
  editors.push(editor);
  render(
    <MemoryRouter>
      <EditorContent editor={editor} />
      <HtmlViewPanel editor={editor} isOpen onClose={() => {}} />
    </MemoryRouter>
  );
  return editor;
}

describe("HtmlViewPanel", () => {
  it("names its close control", () => {
    renderPanel();
    expect(screen.getByRole("button", { name: "common.close" })).toBeInTheDocument();
  });

  it("shows the linter's warning count as a badge", () => {
    renderPanel();
    act(() => capturedCodeMirrorOptions?.onDiagnosticsChange?.(2));

    expect(screen.getByText("editor.warnings")).toBeInTheDocument();
  });

  it("Escape hands focus back to the editor", async () => {
    const user = userEvent.setup();
    const editor = renderPanel();

    screen.getByRole("button", { name: "common.close" }).focus();
    await user.keyboard("{Escape}");

    await waitFor(() => expect(document.activeElement).toBe(editor.view.dom));
  });
});
