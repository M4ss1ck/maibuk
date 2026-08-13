import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateTextNode: vi.fn(),
  resizeTextNode: vi.fn(),
  editorReadOnly: false,
  interactivityLocked: false,
  notes: [] as Array<{
    id: string;
    bookId?: string | null;
    title: string;
    content: string;
    tags: string[];
    contentUpdatedAt: number;
  }>,
  books: [] as Array<{ id: string; title: string }>,
}));

vi.mock("@xyflow/react", () => ({
  Handle: ({ className }: { className?: string }) => (
    <span data-testid="handle" className={className} />
  ),
  Position: { Top: "top", Right: "right", Bottom: "bottom", Left: "left" },
  NodeResizeControl: ({
    position,
    resizeDirection,
    className,
  }: {
    position?: string;
    resizeDirection?: string;
    className?: string;
  }) => (
    <span
      data-testid={`resize-${position}`}
      data-direction={resizeDirection}
      className={className}
    />
  ),
  ResizeControlVariant: { Line: "line", Handle: "handle" },
}));

vi.mock("../../../../features/canvas/store", () => ({
  useCanvasStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      updateTextNode: mocks.updateTextNode,
      resizeTextNode: mocks.resizeTextNode,
      editorReadOnly: mocks.editorReadOnly,
      interactivityLocked: mocks.interactivityLocked,
    }),
}));

vi.mock("../../../../features/notes", () => ({
  useNoteStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ notes: mocks.notes }),
}));

vi.mock("../../../../features/books/store", () => ({
  useBookStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ books: mocks.books }),
}));

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));

const { LightweightNode } = await import("@/features/canvas/nodes/LightweightNode");
const { NoteRefNode } = await import("@/features/canvas/nodes/NoteRefNode");

describe("Canvas custom nodes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.notes = [];
    mocks.books = [];
    mocks.editorReadOnly = false;
    mocks.interactivityLocked = false;
  });

  const textNodeData = (overrides: Record<string, unknown> = {}) => ({
    node: {
      id: "node",
      kind: "text",
      html: "<p>Idea</p>",
      position: { x: 0, y: 0 },
      ...overrides,
    },
    canvasId: "canvas",
    canvasTitle: "Map",
    connectedSides: {
      top: { connected: false, incoming: false, outgoing: false },
      right: { connected: false, incoming: false, outgoing: false },
      bottom: { connected: false, incoming: false, outgoing: false },
      left: { connected: false, incoming: false, outgoing: false },
    },
  });

  it("renders horizontal resize controls on both sides of a selected writable node", () => {
    render(
      <LightweightNode
        {...({ selected: true, data: textNodeData() } as Parameters<typeof LightweightNode>[0])}
      />
    );
    expect(screen.getByTestId("resize-left")).toHaveAttribute("data-direction", "horizontal");
    expect(screen.getByTestId("resize-right")).toHaveAttribute("data-direction", "horizontal");
  });

  it("reveals resize controls on hover when unselected", () => {
    render(
      <LightweightNode
        {...({ selected: false, data: textNodeData() } as Parameters<typeof LightweightNode>[0])}
      />
    );
    const control = screen.getByTestId("resize-left");
    expect(control.className).toContain("opacity-0");
    expect(control.className).toContain("group-hover:opacity-100");
  });

  it("hides resize controls when read-only", () => {
    mocks.editorReadOnly = true;
    render(
      <LightweightNode
        {...({ selected: true, data: textNodeData() } as Parameters<typeof LightweightNode>[0])}
      />
    );
    expect(screen.queryByTestId("resize-left")).toBeNull();
    expect(screen.queryByTestId("resize-right")).toBeNull();
  });

  it("keeps connection handles above resize controls", () => {
    render(
      <LightweightNode
        {...({ selected: true, data: textNodeData() } as Parameters<typeof LightweightNode>[0])}
      />
    );
    const handles = screen.getAllByTestId("handle");
    expect(handles).toHaveLength(4);
    expect(handles.every((handle) => handle.className.includes("z-10!"))).toBe(true);
    expect(screen.getByTestId("resize-left").className).toContain("z-0!");
    expect(screen.getByTestId("resize-right").className).toContain("z-0!");
  });

  it("hides connection ports and resize grips when interactivity is locked", () => {
    mocks.interactivityLocked = true;
    render(
      <LightweightNode
        {...({ selected: true, data: textNodeData() } as Parameters<typeof LightweightNode>[0])}
      />
    );
    expect(screen.queryAllByTestId("handle")).toHaveLength(0);
    expect(screen.queryByTestId("resize-left")).toBeNull();
    expect(screen.queryByTestId("resize-right")).toBeNull();
  });

  it("renders text node html without a card border/background and shows a connected stub", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(
      <LightweightNode
        {...({
          selected: false,
          data: {
            node: {
              id: "node",
              kind: "text",
              html: "<p>Idea</p>",
              textColor: "#ef4444",
              backgroundColor: "#f59e0b",
              position: { x: 0, y: 0 },
            },
            canvasId: "canvas",
            canvasTitle: "Map",
            connectedSides: {
              top: { connected: false, incoming: false, outgoing: false },
              right: { connected: true, incoming: false, outgoing: false },
              bottom: { connected: false, incoming: false, outgoing: false },
              left: { connected: false, incoming: false, outgoing: false },
            },
          },
        } as Parameters<typeof LightweightNode>[0])}
      />
    );
    expect(screen.getByText("Idea")).toBeInTheDocument();
    expect(document.querySelector(".bg-card")).toBeNull();
    expect(document.querySelector(".border-r-2")).not.toBeNull();
    expect(screen.getByText("Idea").closest(".group")).not.toHaveStyle({ color: "#ef4444" });
    expect(screen.getByText("Idea").closest(".canvas-node-content")).toHaveStyle({
      color: "#ef4444",
    });
    expect(screen.getByText("Idea").closest(".group")).toHaveStyle({
      backgroundColor: "#f59e0b",
    });
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("Duplicate extension names"));
    warn.mockRestore();
  });

  it("sanitizes idle html while preserving internal links", () => {
    render(
      <LightweightNode
        {...({
          selected: false,
          data: {
            node: {
              id: "node",
              kind: "text",
              html: '<p>Idea</p><script>alert(1)</script><a href="maibuk://note/n1">Note</a>',
              position: { x: 0, y: 0 },
            },
            canvasId: "canvas",
            canvasTitle: "Map",
            connectedSides: {
              top: { connected: false, incoming: false, outgoing: false },
              right: { connected: false, incoming: false, outgoing: false },
              bottom: { connected: false, incoming: false, outgoing: false },
              left: { connected: false, incoming: false, outgoing: false },
            },
          },
        } as Parameters<typeof LightweightNode>[0])}
      />
    );

    expect(document.querySelector("script")).toBeNull();
    expect(screen.getByRole("link", { name: "Note" })).toHaveAttribute("href", "maibuk://note/n1");
  });

  it("preserves empty paragraphs with the shared idle content renderer", () => {
    render(
      <LightweightNode
        {...({
          selected: false,
          data: {
            node: {
              id: "node",
              kind: "text",
              html: "<p>First</p><p></p><p>Third</p>",
              position: { x: 0, y: 0 },
            },
            canvasId: "canvas",
            canvasTitle: "Map",
            connectedSides: {
              top: { connected: false, incoming: false, outgoing: false },
              right: { connected: false, incoming: false, outgoing: false },
              bottom: { connected: false, incoming: false, outgoing: false },
              left: { connected: false, incoming: false, outgoing: false },
            },
          },
        } as Parameters<typeof LightweightNode>[0])}
      />
    );

    const content = screen.getByText("First").closest(".canvas-node-content");
    expect(content).not.toBeNull();
    const paragraphs = content?.querySelectorAll("p") ?? [];
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs[1]?.querySelector("br")).not.toBeNull();
  });

  it("renders idle tables, images, and numbered footnotes for canvas CSS parity", () => {
    render(
      <LightweightNode
        {...({
          selected: false,
          data: textNodeData({
            html:
              '<table class="editor-table"><tbody><tr><td>Cell</td></tr></tbody></table>' +
              '<figure class="editor-image-figure"><img src="data:image/png;base64,AAA" alt="x"></figure>' +
              '<p>Ref<sup data-footnote="" data-footnote-content="A note" data-footnote-id="a">*</sup></p>',
          }),
        } as Parameters<typeof LightweightNode>[0])}
      />
    );

    expect(document.querySelector(".canvas-node-content .editor-table")).not.toBeNull();
    expect(document.querySelector(".canvas-node-content .editor-image-figure img")).not.toBeNull();
    expect(document.querySelector("sup[data-footnote]")?.textContent).toBe("1");
    expect(document.querySelector(".footnote-section .footnote-content")?.textContent).toBe(
      "A note"
    );
  });

  it("shows a cached label and disables opening when the note is missing", () => {
    render(
      <MemoryRouter>
        <NoteRefNode
          {...({
            selected: false,
            data: {
              node: {
                id: "ref",
                kind: "noteRef",
                noteId: "missing",
                label: "Cached title",
                position: { x: 0, y: 0 },
              },
              canvasId: "canvas",
              canvasTitle: "Map",
              connectedSides: {
                top: { connected: false, incoming: false, outgoing: false },
                right: { connected: false, incoming: false, outgoing: false },
                bottom: { connected: false, incoming: false, outgoing: false },
                left: { connected: false, incoming: false, outgoing: false },
              },
            },
          } as Parameters<typeof NoteRefNode>[0])}
        />
      </MemoryRouter>
    );
    expect(screen.getByText("Cached title")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "canvas.openNote" })).toBeDisabled();
    expect(screen.getAllByTestId("handle")).toHaveLength(4);
  });

  it("renders the preview for a note without a linked book", () => {
    mocks.notes = [
      {
        id: "note-1",
        title: "Loose note",
        content: "A long standalone note preview",
        tags: [],
        contentUpdatedAt: 1,
      },
    ];

    render(
      <MemoryRouter>
        <NoteRefNode
          {...({
            selected: false,
            data: {
              node: {
                id: "ref",
                kind: "noteRef",
                noteId: "note-1",
                position: { x: 0, y: 0 },
              },
              canvasId: "canvas",
              canvasTitle: "Map",
              connectedSides: {},
            },
          } as Parameters<typeof NoteRefNode>[0])}
        />
      </MemoryRouter>
    );

    expect(screen.getByText("A long standalone note preview")).toHaveClass("line-clamp-3");
  });

  it("shows the book title and previews a linked note the same as a loose one", () => {
    mocks.notes = [
      {
        id: "note-1",
        bookId: "book-1",
        title: "Filed note",
        content: "A long linked note preview",
        tags: [],
        contentUpdatedAt: 1,
      },
    ];
    mocks.books = [{ id: "book-1", title: "The Novel" }];

    render(
      <MemoryRouter>
        <NoteRefNode
          {...({
            selected: false,
            data: {
              node: {
                id: "ref",
                kind: "noteRef",
                noteId: "note-1",
                position: { x: 0, y: 0 },
              },
              canvasId: "canvas",
              canvasTitle: "Map",
              connectedSides: {},
            },
          } as Parameters<typeof NoteRefNode>[0])}
        />
      </MemoryRouter>
    );

    expect(screen.getByText("Filed note")).toBeInTheDocument();
    expect(screen.getByText("The Novel")).toBeInTheDocument();
    expect(screen.getByText("A long linked note preview")).toHaveClass("line-clamp-3");
  });
});
