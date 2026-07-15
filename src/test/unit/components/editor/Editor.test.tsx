import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Editor as TiptapEditor } from "@tiptap/core";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Editor } from "@/components/editor/Editor";
import { CollapsibleHeading } from "@/components/editor/extensions";
import { assignHeadingIds } from "@/features/links/heading-ids";

const { mockSetContentSilently } = vi.hoisted(() => ({
  mockSetContentSilently: vi.fn(),
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

// jsdom polyfill — DataTransfer and ClipboardEvent are not defined in jsdom
if (typeof globalThis.DataTransfer === "undefined") {
  (globalThis as any).DataTransfer = class DataTransfer {
    private data: Record<string, string> = {};
    getData(format: string) { return this.data[format] ?? ""; }
    setData(format: string, value: string) { this.data[format] = value; }
    clearData() { this.data = {}; }
    get types() { return Object.keys(this.data); }
    get files() { return []; }
    get items() { return []; }
  };
}
if (typeof globalThis.ClipboardEvent === "undefined") {
  (globalThis as any).ClipboardEvent = class ClipboardEvent extends Event {
    clipboardData: any;
    constructor(type: string, init?: any) {
      super(type, init);
      this.clipboardData = init?.clipboardData ?? null;
    }
  };
}

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
        promptMarkdownOnPaste: true,
      }),
    {
      getState: () => ({
        spellCheckEnabled: false,
        language: "en",
        editorShowBorder: false,
        metrics: { enabled: { writing: false } },
        promptMarkdownOnPaste: true,
      }),
    }
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
  SelectionToolbar: ({ onLinkClick }: { onLinkClick?: () => void }) =>
    onLinkClick ? (
      <button type="button" data-testid="open-link-dialog" onClick={onLinkClick}>
        link
      </button>
    ) : null,
}));

vi.mock("../../../../components/editor/LinkClickHandler", () => ({
  LinkClickHandler: () => null,
}));

vi.mock("../../../../components/editor/LinkDialog", () => ({
  LinkDialog: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? (
      <div
        data-testid="link-dialog"
        role="dialog"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      />
    ) : null,
}));

vi.mock("../../../../components/editor/ImageContextMenu", () => ({
  ImageContextMenu: () => null,
}));

vi.mock("../../../../components/editor/FootnoteList", () => ({
  FootnoteList: () => null,
}));

vi.mock("../../../../components/editor/MarkdownPasteDialog", async () => ({
  MarkdownPasteDialog: ({ markdown }: { markdown: string | null }) =>
    markdown ? <div data-testid="markdown-paste-dialog" role="dialog">{markdown}</div> : null,
}));

vi.mock("../../../../components/editor/extensions/SpellCheck", async () => {
  const { Extension } = await vi.importActual<typeof import("@tiptap/core")>("@tiptap/core");
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
      <Editor content={"<p>Loaded chapter</p>\n"} onUpdate={vi.fn()} onWordCountChange={vi.fn()} />
    );

    await waitFor(() => {
      expect(mockSetContentSilently).not.toHaveBeenCalled();
    });
  });

  // Regression: the chapter store normalizes saved HTML with assignHeadingIds
  // (adding ids to headings) and echoes it back into the `content` prop. That
  // normalized echo differs from the raw HTML the editor emitted, so the
  // external-content sync used to fire setContentSilently mid-edit, resetting
  // the document and jerking the caret elsewhere.
  it("does not re-apply content that is a normalized echo of the user's own edit", async () => {
    let editor: TiptapEditor | null = null;
    let lastContentProp = "";

    // Harness mirrors BookEditor -> chapter store: every update is normalized
    // through assignHeadingIds (which stamps ids onto un-id'd headings) and fed
    // straight back down as `content`.
    function RoundTripHarness() {
      const [content, setContent] = useState("<h2>Chapter Title</h2><p>Body</p>");
      lastContentProp = content;
      return (
        <Editor
          content={content}
          onUpdate={(html) => setContent(assignHeadingIds(html).html)}
          onWordCountChange={vi.fn()}
          onEditorReady={(instance) => {
            editor = instance;
          }}
        />
      );
    }

    render(<RoundTripHarness />);

    await waitFor(() => {
      expect(editor).not.toBeNull();
    });

    mockSetContentSilently.mockClear();

    // Simulate the user typing a character. This fires onUpdate, which routes
    // the raw HTML through assignHeadingIds and echoes the normalized result
    // (now carrying a fresh heading id) back into the `content` prop.
    editor!.chain().focus("end").insertContent("!").run();

    // Wait until the normalized echo has propagated back down as `content`.
    // waitFor flushes React effects between polls, so once the id-bearing echo
    // is the current prop, the external-content sync effect has already run.
    await waitFor(() => {
      expect(lastContentProp).toContain('id="h-');
    });

    // The normalized echo is the editor's own output, not a genuine external
    // change, so it must NOT trigger a full-document reset (which would jerk
    // the caret away from where the user is typing).
    expect(mockSetContentSilently).not.toHaveBeenCalled();
  });

  it("still applies a genuinely external content change (e.g. version restore)", async () => {
    const { rerender } = render(
      <Editor content={"<p>Original</p>"} onUpdate={vi.fn()} onWordCountChange={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByText("Original")).toBeInTheDocument();
    });

    mockSetContentSilently.mockClear();

    // An external change (not an echo of the editor's own document) must reset
    // the document so restores/deep-links keep working.
    rerender(
      <Editor content={"<p>Restored from a version</p>"} onUpdate={vi.fn()} onWordCountChange={vi.fn()} />
    );

    await waitFor(() => {
      expect(mockSetContentSilently).toHaveBeenCalledWith(
        expect.anything(),
        "<p>Restored from a version</p>"
      );
    });
  });

  it("passes bookId and internalTargets to EditorToolbar", async () => {
    render(<Editor content={"<p>Chapter</p>\n"} onUpdate={vi.fn()} bookId="b1" chapterId="c1" />);

    await waitFor(() => {
      expect(capturedToolbarProps.length).toBeGreaterThan(0);
    });

    const lastProps = capturedToolbarProps[capturedToolbarProps.length - 1];
    expect(lastProps.bookId).toBe("b1");
    expect(lastProps.internalTargets).toBeDefined();
  });

  it("passes the document spellcheck language to EditorToolbar", async () => {
    const onSpellCheckLanguageChange = vi.fn();

    render(
      <Editor
        content={"<p>Chapter</p>\n"}
        onUpdate={vi.fn()}
        spellCheckLanguage="es"
        onSpellCheckLanguageChange={onSpellCheckLanguageChange}
      />
    );

    await waitFor(() => {
      expect(capturedToolbarProps.length).toBeGreaterThan(0);
    });

    const lastProps = capturedToolbarProps[capturedToolbarProps.length - 1];
    expect(lastProps.spellCheckLanguage).toBe("es");
    expect(lastProps.onSpellCheckLanguageChange).toBe(onSpellCheckLanguageChange);
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
      />
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
      />
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
      />
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

  it("updates a code block language from the hover control", async () => {
    const onUpdate = vi.fn();

    render(
      <Editor
        content={'<pre><code class="language-javascript">const value = 1</code></pre>'}
        onUpdate={onUpdate}
      />
    );

    const languageButton = await screen.findByRole("button", {
      name: "editor.editCodeBlockLanguage",
    });
    expect(languageButton).toHaveTextContent("javascript");

    await userEvent.click(languageButton);
    const languageInput = screen.getByLabelText("editor.codeBlockLanguage");
    await userEvent.clear(languageInput);
    await userEvent.type(languageInput, "python{Enter}");

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith(expect.stringContaining('class="language-python"'));
    });
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
      />
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

  it("calls onEscape when Escape is pressed in the editor", async () => {
    const user = userEvent.setup();
    const onEscape = vi.fn();
    let editor: TiptapEditor | null = null;

    const { container } = render(
      <Editor
        content={"<p>hello</p>"}
        onUpdate={vi.fn()}
        onEscape={onEscape}
        onEditorReady={(instance) => {
          editor = instance;
        }}
      />
    );

    await waitFor(() => {
      expect(editor).not.toBeNull();
    });

    const editorEl = container.querySelector('[contenteditable="true"]') as HTMLElement;
    editorEl.focus();
    await user.keyboard("{Escape}");

    expect(onEscape).toHaveBeenCalled();
  });

  it("does not call onEscape when non-Escape key is pressed", async () => {
    const user = userEvent.setup();
    const onEscape = vi.fn();
    let editor: TiptapEditor | null = null;

    const { container } = render(
      <Editor
        content={"<p>hello</p>"}
        onUpdate={vi.fn()}
        onEscape={onEscape}
        onEditorReady={(instance) => {
          editor = instance;
        }}
      />
    );

    await waitFor(() => {
      expect(editor).not.toBeNull();
    });

    const editorEl = container.querySelector('[contenteditable="true"]') as HTMLElement;
    editorEl.focus();
    await user.keyboard("{ArrowLeft}");

    expect(onEscape).not.toHaveBeenCalled();
  });

  it("Escape defers to open LinkDialog and does not call onEscape", async () => {
    const user = userEvent.setup();
    const onEscape = vi.fn();
    let editor: TiptapEditor | null = null;

    const { container } = render(
      <Editor
        content={"<p>hello world</p>"}
        onUpdate={vi.fn()}
        onEscape={onEscape}
        onEditorReady={(instance) => {
          editor = instance;
        }}
      />
    );

    await waitFor(() => {
      expect(editor).not.toBeNull();
    });

    // Select some text to make the SelectionToolbar appear
    editor!.chain().setTextSelection({ from: 1, to: 5 }).run();

    // Click the "open link dialog" button rendered by SelectionToolbar mock
    await waitFor(() => {
      expect(container.querySelector('[data-testid="open-link-dialog"]')).not.toBeNull();
    });
    const linkBtn = container.querySelector('[data-testid="open-link-dialog"]') as HTMLElement;
    fireEvent.click(linkBtn);

    // LinkDialog should now be open
    await waitFor(() => {
      expect(container.querySelector('[data-testid="link-dialog"]')).not.toBeNull();
    });

    // Press Escape on the editor
    const editorEl = container.querySelector('[contenteditable="true"]') as HTMLElement;
    fireEvent.keyDown(editorEl, { key: "Escape", code: "Escape" });

    // The editor defers structural Escape while its popup is open.
    expect(onEscape).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    screen.getByRole("dialog").focus();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onEscape).not.toHaveBeenCalled();
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
