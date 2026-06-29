// src/test/unit/components/editor/LinkDialog.internal.test.tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LinkDialog } from "@/components/editor/LinkDialog";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const setLink = vi.fn(() => ({ run: vi.fn() }));
const insertContent = vi.fn(() => ({ run: vi.fn() }));
const focus = vi.fn(() => ({ setLink, insertContent }));
const chain = vi.fn(() => ({ focus }));

const editor = {
  state: {
    selection: { from: 1, to: 5 },
    doc: { textBetween: () => "anchor" },
  },
  getAttributes: () => ({}),
  chain,
} as unknown as import("@tiptap/react").Editor;

describe("LinkDialog internal target picker", () => {
  beforeEach(() => vi.clearAllMocks());

  it("inserts a maibuk chapter link when a chapter is chosen", () => {
    render(
      <LinkDialog
        editor={editor}
        isOpen
        onClose={() => {}}
        bookId="b1"
        internalTargets={[
          {
            type: "chapter",
            chapterId: "c1",
            title: "Chapter One",
            headingId: null,
          },
          {
            type: "heading",
            chapterId: "c1",
            title: "A Section",
            headingId: "h-1",
          },
        ]}
      />
    );

    fireEvent.click(screen.getByText("editor.linkInThisBook"));
    fireEvent.click(screen.getByText("Chapter One"));

    expect(setLink).toHaveBeenCalledWith({ href: "maibuk://chapter/c1" });
  });

  it("inserts target title as linked text when no selection is active", () => {
    const noSelectionEditor = {
      ...editor,
      state: {
        selection: { from: 5, to: 5 },
        doc: { textBetween: () => "" },
      },
    } as unknown as import("@tiptap/react").Editor;

    render(
      <LinkDialog
        editor={noSelectionEditor}
        isOpen
        onClose={() => {}}
        bookId="b1"
        internalTargets={[
          {
            type: "chapter",
            chapterId: "c1",
            title: "Chapter One",
            headingId: null,
          },
        ]}
      />
    );

    fireEvent.click(screen.getByText("editor.linkInThisBook"));
    fireEvent.click(screen.getByText("Chapter One"));

    expect(insertContent).toHaveBeenCalledWith('<a href="maibuk://chapter/c1">Chapter One</a>');
  });

  it("inserts a maibuk heading link when a heading is chosen", () => {
    render(
      <LinkDialog
        editor={editor}
        isOpen
        onClose={() => {}}
        bookId="b1"
        internalTargets={[
          {
            type: "heading",
            chapterId: "c1",
            title: "A Section",
            headingId: "h-1",
          },
        ]}
      />
    );
    fireEvent.click(screen.getByText("editor.linkInThisBook"));
    fireEvent.click(screen.getByText("A Section"));
    expect(setLink).toHaveBeenCalledWith({ href: "maibuk://heading/c1/h-1" });
  });

  it("shows and inserts note targets without a book id", () => {
    render(
      <LinkDialog
        editor={editor}
        isOpen
        onClose={() => {}}
        internalTargets={[
          {
            type: "note",
            noteId: "n2",
            title: "Research Note",
          },
        ]}
      />
    );

    fireEvent.click(screen.getByText("editor.linkInThisBook"));
    fireEvent.change(screen.getByPlaceholderText("editor.searchTargets"), {
      target: { value: "research" },
    });
    fireEvent.click(screen.getByText("Research Note"));

    expect(setLink).toHaveBeenCalledWith({ href: "maibuk://note/n2" });
  });

  it("labels note and book targets with their type", () => {
    render(
      <LinkDialog
        editor={editor}
        isOpen
        onClose={() => {}}
        internalTargets={[
          {
            type: "note",
            noteId: "n2",
            title: "Shared Title",
          },
          {
            type: "book",
            bookId: "b1",
            title: "Shared Title",
          },
        ]}
      />
    );

    fireEvent.click(screen.getByText("editor.linkInThisBook"));

    expect(screen.getByText("editor.linkTargetNote")).toBeInTheDocument();
    expect(screen.getByText("editor.linkTargetBook")).toBeInTheDocument();
  });

  it("lazy loads book children when the book target is expanded", async () => {
    const loadInternalTargetChildren = vi.fn(async () => [
      {
        type: "chapter" as const,
        chapterId: "chapter-1",
        title: "Opening Chapter",
        headingId: null,
      },
    ]);

    render(
      <LinkDialog
        editor={editor}
        isOpen
        onClose={() => {}}
        internalTargets={[
          {
            type: "book",
            bookId: "book-1",
            title: "Novel Draft",
          },
        ]}
        loadInternalTargetChildren={loadInternalTargetChildren}
      />
    );

    fireEvent.click(screen.getByText("editor.linkInThisBook"));

    expect(screen.queryByText("Opening Chapter")).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("editor.expandLinkTarget Novel Draft"));

    await waitFor(() =>
      expect(loadInternalTargetChildren).toHaveBeenCalledWith({
        type: "book",
        bookId: "book-1",
        title: "Novel Draft",
      })
    );
    expect(await screen.findByText("Opening Chapter")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Opening Chapter"));

    expect(setLink).toHaveBeenCalledWith({ href: "maibuk://chapter/chapter-1" });
  });

  it("lazy loads note heading children when the note target is expanded", async () => {
    const loadInternalTargetChildren = vi.fn(async () => [
      {
        type: "noteHeading" as const,
        noteId: "note-2",
        title: "Research Question",
        headingId: "h-research",
      },
    ]);

    render(
      <LinkDialog
        editor={editor}
        isOpen
        onClose={() => {}}
        internalTargets={[
          {
            type: "note",
            noteId: "note-2",
            title: "Research Note",
          },
        ]}
        loadInternalTargetChildren={loadInternalTargetChildren}
      />
    );

    fireEvent.click(screen.getByText("editor.linkInThisBook"));

    expect(screen.queryByText("Research Question")).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("editor.expandLinkTarget Research Note"));

    expect(await screen.findByText("Research Question")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Research Question"));

    expect(setLink).toHaveBeenCalledWith({
      href: "maibuk://note-heading/note-2/h-research",
    });
  });

  it("inserts target title as linked text when selecting an empty line", () => {
    const emptyLineEditor = {
      ...editor,
      state: {
        selection: { from: 5, to: 6 },
        doc: { textBetween: () => "" },
      },
    } as unknown as import("@tiptap/react").Editor;

    render(
      <LinkDialog
        editor={emptyLineEditor}
        isOpen
        onClose={() => {}}
        bookId="b1"
        internalTargets={[
          {
            type: "chapter",
            chapterId: "c1",
            title: "Chapter One",
            headingId: null,
          },
        ]}
      />
    );

    fireEvent.click(screen.getByText("editor.linkInThisBook"));
    fireEvent.click(screen.getByText("Chapter One"));

    expect(insertContent).toHaveBeenCalledWith('<a href="maibuk://chapter/c1">Chapter One</a>');
  });

  it("uses custom display text when provided in internal mode", () => {
    render(
      <LinkDialog
        editor={editor}
        isOpen
        onClose={() => {}}
        bookId="b1"
        internalTargets={[
          {
            type: "chapter",
            chapterId: "c1",
            title: "Chapter One",
            headingId: null,
          },
        ]}
      />
    );

    fireEvent.click(screen.getByText("editor.linkInThisBook"));

    const textInput = screen.getByPlaceholderText("editor.linkText");
    fireEvent.change(textInput, { target: { value: "Custom Label" } });

    fireEvent.click(screen.getByText("Chapter One"));

    expect(insertContent).toHaveBeenCalledWith('<a href="maibuk://chapter/c1">Custom Label</a>');
  });

  it("preserves an existing internal href when editing display text", () => {
    const internalLinkEditor = {
      ...editor,
      getAttributes: () => ({ href: "maibuk://chapter/c1" }),
    } as unknown as import("@tiptap/react").Editor;

    render(
      <LinkDialog
        editor={internalLinkEditor}
        isOpen
        onClose={() => {}}
        bookId="b1"
        internalTargets={[
          {
            type: "chapter",
            chapterId: "c1",
            title: "Chapter One",
            headingId: null,
          },
        ]}
      />
    );

    const textInput = screen.getByPlaceholderText("editor.linkText");
    fireEvent.change(textInput, { target: { value: "Custom Label" } });

    fireEvent.click(screen.getByText("common.update"));

    expect(insertContent).toHaveBeenCalledWith('<a href="maibuk://chapter/c1">Custom Label</a>');
  });

  it("preserves existing marks when editing internal link display text", () => {
    const internalLinkEditor = {
      ...editor,
      state: {
        selection: { from: 1, to: 5 },
        doc: {
          textBetween: () => "anchor",
          nodesBetween: (
            _from: number,
            _to: number,
            callback: (node: {
              isText: boolean;
              marks: {
                type: { name: string };
                attrs: Record<string, unknown>;
              }[];
            }) => void
          ) =>
            callback({
              isText: true,
              marks: [
                { type: { name: "bold" }, attrs: {} },
                {
                  type: { name: "textStyle" },
                  attrs: { fontSize: "20px" },
                },
                {
                  type: { name: "link" },
                  attrs: { href: "maibuk://chapter/c1" },
                },
              ],
            }),
        },
      },
      getAttributes: () => ({ href: "maibuk://chapter/c1" }),
    } as unknown as import("@tiptap/react").Editor;

    render(
      <LinkDialog
        editor={internalLinkEditor}
        isOpen
        onClose={() => {}}
        bookId="b1"
        internalTargets={[
          {
            type: "chapter",
            chapterId: "c1",
            title: "Chapter One",
            headingId: null,
          },
        ]}
      />
    );

    const textInput = screen.getByPlaceholderText("editor.linkText");
    fireEvent.change(textInput, { target: { value: "Custom Label" } });

    fireEvent.click(screen.getByText("common.update"));

    expect(insertContent).toHaveBeenCalledWith({
      type: "text",
      text: "Custom Label",
      marks: [
        { type: "bold", attrs: {} },
        { type: "textStyle", attrs: { fontSize: "20px" } },
        { type: "link", attrs: { href: "maibuk://chapter/c1" } },
      ],
    });
  });

  it("uses custom display text when provided in url mode with a selection", () => {
    render(<LinkDialog editor={editor} isOpen onClose={() => {}} />);

    const urlInput = screen.getByPlaceholderText("https://example.com");
    fireEvent.change(urlInput, { target: { value: "https://example.com" } });

    const textInput = screen.getByPlaceholderText("editor.linkText");
    fireEvent.change(textInput, { target: { value: "Custom Label" } });

    fireEvent.click(screen.getByText("common.insert"));

    expect(insertContent).toHaveBeenCalledWith('<a href="https://example.com">Custom Label</a>');
  });
});
