import { act, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEditorSurface } from "@/components/editor/EditorSurface";
import { createRichTextExtensions } from "@/components/editor/extensions/createRichTextExtensions";
import { SearchReplace } from "@/components/editor/extensions/SearchReplace";
import {
  forgetEditor,
  lastFocusedEditor,
  noteEditorFocused,
  useEditorCommandSource,
  useIsActiveEditor,
} from "@/components/editor/editor-command-source";
import { useModalStore } from "@/components/ui/modal-store";
import { useSearchSwitchesStore } from "@/features/search/switches";
import { useTutorialStore } from "@/features/tutorial/store";
import { runCommand } from "@/lib/command-runner";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

// ProseMirror measures the selection while handling real keyboard events, but
// jsdom does not implement these geometry methods on every possible node.
const emptyRect: DOMRect = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  toJSON: () => ({}),
};
const emptyRects = (): DOMRectList =>
  ({ 0: emptyRect, length: 1, item: () => emptyRect }) as unknown as DOMRectList;

for (const prototype of [Range.prototype, Text.prototype, Comment.prototype]) {
  const geometry = prototype as unknown as {
    getClientRects?: () => DOMRectList;
    getBoundingClientRect?: () => DOMRect;
  };
  geometry.getClientRects ??= emptyRects;
  geometry.getBoundingClientRect ??= () => emptyRect;
}

Element.prototype.scrollIntoView ??= function scrollIntoView() {};

const editors: Editor[] = [];

function createEditor(content = "<p>Hello world</p>") {
  const editor = new Editor({
    content,
    extensions: [...createRichTextExtensions(), SearchReplace],
  });
  editors.push(editor);
  return editor;
}

function SurfaceHost({ editor, label }: { editor: Editor; label: string }) {
  useEditorCommandSource(editor);
  const { surface } = useEditorSurface(editor, { spellCheckLanguage: "en" });
  return (
    <div data-testid={label}>
      <EditorContent editor={editor} />
      {surface}
    </div>
  );
}

beforeEach(() => {
  // TipTap's focus command settles the DOM focus on the next animation frame;
  // run it synchronously so the selection lands in the test.
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  const focused = lastFocusedEditor();
  if (focused) forgetEditor(focused);
  useModalStore.setState({ modalIds: [], openCount: 0, closers: {} });
  useTutorialStore.setState({ status: "idle" });
  useSearchSwitchesStore.setState({ matchCase: false, wholeWord: false, regex: false });
});

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  const focused = lastFocusedEditor();
  if (focused) forgetEditor(focused);
  vi.unstubAllGlobals();
});

describe("useEditorSurface", () => {
  it("opens Find and Replace on Mod+F and focuses the find field", async () => {
    const user = userEvent.setup();
    const editor = createEditor();
    render(<SurfaceHost editor={editor} label="host" />);

    act(() => {
      editor.view.dom.focus();
    });
    await user.keyboard("{Control>}f{/Control}");

    const find = await screen.findByPlaceholderText("editor.find");
    await waitFor(() => expect(find).toHaveFocus());
  });

  it("opens the Link dialog on Mod+K", async () => {
    const user = userEvent.setup();
    const editor = createEditor();
    render(<SurfaceHost editor={editor} label="host" />);

    act(() => {
      editor.view.dom.focus();
    });
    await user.keyboard("{Control>}k{/Control}");

    expect(await screen.findByRole("dialog", { name: "editor.insertLink" })).toBeInTheDocument();
  });

  it("inserts a horizontal rule when the Command runs from the palette", async () => {
    const editor = createEditor();
    render(<SurfaceHost editor={editor} label="host" />);

    const outcome = await runCommand("editor.horizontalRule", { source: "palette" });

    expect(outcome).toBe("ran");
    expect(editor.getHTML()).toContain("<hr");
  });

  it("keeps the Find bar for the editor focused last", async () => {
    const user = userEvent.setup();
    const first = createEditor("<p>alpha</p>");
    const second = createEditor("<p>beta</p>");
    render(
      <>
        <SurfaceHost editor={first} label="first" />
        <SurfaceHost editor={second} label="second" />
      </>
    );

    act(() => {
      first.view.dom.focus();
    });
    act(() => {
      second.view.dom.focus();
    });
    await user.keyboard("{Control>}f{/Control}");

    const secondHost = screen.getByTestId("second");
    const firstHost = screen.getByTestId("first");
    await waitFor(() =>
      expect(within(secondHost).getByPlaceholderText("editor.find")).toBeInTheDocument()
    );
    expect(within(firstHost).queryByPlaceholderText("editor.find")).not.toBeInTheDocument();
  });
});

describe("useIsActiveEditor", () => {
  it("is active for the last focused editor, and for any editor before one is focused", () => {
    const first = createEditor();
    const second = createEditor();
    const { result, rerender } = renderHook(({ editor }) => useIsActiveEditor(editor), {
      initialProps: { editor: first as Editor | null },
    });

    expect(result.current).toBe(true);

    act(() => noteEditorFocused(second));
    expect(result.current).toBe(false);

    act(() => noteEditorFocused(first));
    expect(result.current).toBe(true);

    act(() => forgetEditor(first));
    expect(result.current).toBe(true);

    rerender({ editor: null });
    expect(result.current).toBe(false);
  });
});

describe("useEditorCommandSource", () => {
  it("notes an editor that already holds focus when the source mounts", () => {
    // A Text Node focuses its editor in a layout effect, before this passive
    // effect subscribes to focus events: no focus event follows.
    const other = createEditor();
    noteEditorFocused(other);
    const editor = createEditor();
    const element = document.createElement("div");
    document.body.append(element);
    element.append(editor.view.dom);
    editor.view.focus();
    expect(editor.isFocused).toBe(true);

    renderHook(() => useEditorCommandSource(editor));

    expect(lastFocusedEditor()).toBe(editor);
    element.remove();
  });
});
