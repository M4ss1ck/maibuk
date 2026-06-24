import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Editor as TiptapEditor } from "@tiptap/core";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Editor } from "../../../../components/editor/Editor";
import { CollapsibleHeading } from "../../../../components/editor/extensions";

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
  useSettingsStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        spellCheckEnabled: false,
        language: "en",
        editorShowBorder: false,
        metrics: { enabled: { writing: false } },
      }),
    {
      getState: () => ({
        spellCheckEnabled: false,
        language: "en",
        editorShowBorder: false,
        metrics: { enabled: { writing: false } },
      }),
    },
  ),
}));

vi.mock("../../../../features/metrics/programmatic", () => ({
  setContentSilently: mockSetContentSilently,
}));

const capturedToolbarProps: Record<string, unknown>[] = [];

vi.mock("../../../../components/editor/EditorToolbar", () => ({
  EditorToolbar: (props: Record<string, unknown>) => {
    capturedToolbarProps.push(props);
    return null;
  },
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
    capturedToolbarProps.length = 0;
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

  it("passes bookId and internalTargets to EditorToolbar", async () => {
    render(
      <Editor
        content={"<p>Chapter</p>\n"}
        onUpdate={vi.fn()}
        bookId="b1"
        chapterId="c1"
      />,
    );

    await waitFor(() => {
      expect(capturedToolbarProps.length).toBeGreaterThan(0);
    });

    const lastProps = capturedToolbarProps[capturedToolbarProps.length - 1];
    expect(lastProps.bookId).toBe("b1");
    expect(lastProps.internalTargets).toBeDefined();
  });

  it("focuses the editor when the blank editor surround is clicked", async () => {
    let editor: TiptapEditor | null = null;

    const { container } = render(
      <Editor
        content={"<p>Chapter</p>\n"}
        onUpdate={vi.fn()}
        onEditorReady={(instance) => {
          editor = instance;
        }}
      />,
    );

    await waitFor(() => {
      expect(editor).not.toBeNull();
    });

    const focusCalls = trackFocusCalls(editor!);

    const surround = container.querySelector(".editor-content-surface") as HTMLElement | null;
    expect(surround).not.toBeNull();
    await userEvent.click(surround!);

    expect(focusCalls.some((args) => args.length === 0)).toBe(true);
  });

  it("does not refocus the previous selection when a task checkbox is clicked", async () => {
    let editor: TiptapEditor | null = null;

    const { container } = render(
      <Editor
        content={
          '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>item 1</p></li></ul>'
        }
        onUpdate={vi.fn()}
        extraExtensions={[TaskList, TaskItem.configure({ nested: true })]}
        onEditorReady={(instance) => {
          editor = instance;
        }}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector("input[type='checkbox']")).not.toBeNull();
      expect(editor).not.toBeNull();
    });

    const focusCalls = trackFocusCalls(editor!);

    await userEvent.click(container.querySelector("input[type='checkbox']")!);

    expect(focusCalls.some((args) => args.length === 0)).toBe(false);
  });

  it("does not refocus the previous selection when the code block copy button is clicked", async () => {
    let editor: TiptapEditor | null = null;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(
      <Editor
        content={"<pre><code>copy me</code></pre>"}
        onUpdate={vi.fn()}
        onEditorReady={(instance) => {
          editor = instance;
        }}
      />,
    );

    const copyButton = await screen.findByRole("button", { name: "editor.copyCode" });
    await waitFor(() => {
      expect(editor).not.toBeNull();
    });

    const focusCalls = trackFocusCalls(editor!);

    await userEvent.click(copyButton);

    expect(writeText).toHaveBeenCalledWith("copy me");
    expect(focusCalls.some((args) => args.length === 0)).toBe(false);
  });

  it("does not refocus the previous selection when a heading toggle is clicked", async () => {
    let editor: TiptapEditor | null = null;

    const { container } = render(
      <Editor
        content={'<h2 data-heading-id="h1">Title</h2><p>Body</p>'}
        onUpdate={vi.fn()}
        extraExtensions={[
          CollapsibleHeading.configure({
            collapseLabel: "Collapse heading",
            expandLabel: "Expand heading",
            collapsedHeadings: [],
          }),
        ]}
        onEditorReady={(instance) => {
          editor = instance;
        }}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector(".heading-collapse-toggle")).not.toBeNull();
      expect(editor).not.toBeNull();
    });

    const focusCalls = trackFocusCalls(editor!);

    const toggle = container.querySelector(".heading-collapse-toggle") as HTMLElement;
    fireEvent.mouseDown(toggle, { bubbles: true, cancelable: true });
    fireEvent.click(toggle, { bubbles: true, cancelable: true });

    expect(focusCalls.some((args) => args.length === 0)).toBe(false);
  });
});

function trackFocusCalls(editor: TiptapEditor): unknown[][] {
  const focusCalls: unknown[][] = [];
  const originalChain = editor.chain.bind(editor);

  editor.chain = (() => {
    const chain = originalChain();
    const originalFocus = chain.focus.bind(chain);
    chain.focus = ((...args: unknown[]) => {
      focusCalls.push(args);
      return originalFocus(...(args as Parameters<typeof originalFocus>));
    }) as typeof chain.focus;
    return chain;
  }) as TiptapEditor["chain"];

  return focusCalls;
}
