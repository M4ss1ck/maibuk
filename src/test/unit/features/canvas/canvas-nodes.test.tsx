import { mockItemMenuLayout } from "@/test/support/item-menu-layout";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Book } from "@/features/books/types";
import type { ChapterReferenceValue } from "@/features/canvas/chapterReferenceSource";
import type { Note } from "@/features/notes";
import { installPointerEvent, touchLongPress, touchTap } from "@/test/support/pointer-events";

installPointerEvent();

/** A Text Node uses Link navigation, so it needs the Router the app provides. */
function renderNode(ui: Parameters<typeof render>[0]) {
  return render(ui, { wrapper: MemoryRouter });
}

const mocks = vi.hoisted(() => ({
  updateTextNode: vi.fn(),
  resizeTextNode: vi.fn(),
  selectNode: vi.fn(),
  removeNode: vi.fn(),
  openConnectPicker: vi.fn(),
  beginNodeEdit: vi.fn(),
  endNodeEdit: vi.fn(),
  editingNodeId: null as string | null,
  editorReadOnly: false,
  interactivityLocked: false,
  books: [] as Book[],
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
      selectNode: mocks.selectNode,
      removeNode: mocks.removeNode,
      openConnectPicker: mocks.openConnectPicker,
      beginNodeEdit: mocks.beginNodeEdit,
      endNodeEdit: mocks.endNodeEdit,
      editingNodeId: mocks.editingNodeId,
      editorReadOnly: mocks.editorReadOnly,
      interactivityLocked: mocks.interactivityLocked,
    }),
}));

vi.mock("../../../../features/books/store", () => ({
  useBookStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ books: mocks.books }),
}));

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

const { LightweightNode } = await import("@/features/canvas/nodes/LightweightNode");
const { ReferenceNode } = await import("@/features/canvas/nodes/ReferenceNode");
const { noteReferenceSource } = await import("@/features/canvas/noteReferenceSource");
const { chapterReferenceSource } = await import("@/features/canvas/chapterReferenceSource");
const { CANVAS_REFERENCE_CARD_SIZES, useCanvasReferenceResolutions } = await import(
  "@/features/canvas/references"
);
const { useNoteStore } = await import("@/features/notes");

function noteRow(overrides: Partial<Note> = {}): Note {
  return {
    id: "note-1",
    title: "Log",
    content: "<p>Body</p>",
    language: "en",
    tags: [],
    pinned: false,
    order: 0,
    wordCount: 0,
    collapsedHeadings: [],
    createdAt: 1,
    updatedAt: 1,
    contentUpdatedAt: 1,
    ...overrides,
  };
}

function bookRow(overrides: Partial<Book> = {}): Book {
  return {
    id: "book-1",
    title: "Harbour light",
    authorName: "Ada Reyes",
    language: "en",
    wordCount: 1200,
    status: "draft",
    createdAt: new Date("2024-01-02"),
    updatedAt: new Date("2024-01-03"),
    contentUpdatedAt: new Date("2024-01-04"),
    ...overrides,
  };
}

function chapterRow(overrides: Partial<ChapterReferenceValue> = {}): ChapterReferenceValue {
  return {
    id: "chapter-1",
    bookId: "book-1",
    title: "Harbour light",
    content: "<p>Rain on the pier</p>",
    updatedAt: new Date(),
    bookTitle: "The Novel",
    ...overrides,
  };
}

/** The answers the source store holds for one target. */
function answer(
  source: string,
  targetId: string,
  resolution: { status: "present"; title: string; value: unknown } | { status: "missing" }
) {
  useCanvasReferenceResolutions.getState().mergeAnswers(source, { [targetId]: resolution });
}

const referenceData = (node: Record<string, unknown> = {}) => ({
  node: {
    id: "ref",
    kind: "reference",
    source: "note",
    targetId: "note-1",
    position: { x: 0, y: 0 },
    ...node,
  },
  canvasId: "canvas",
  canvasTitle: "Map",
  connectedSides: {},
});

function renderReference(data: ReturnType<typeof referenceData> = referenceData()) {
  return render(
    <MemoryRouter>
      <ReferenceNode {...({ selected: false, data } as Parameters<typeof ReferenceNode>[0])} />
    </MemoryRouter>
  );
}

describe("Canvas custom nodes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.books = [];
    mocks.editorReadOnly = false;
    mocks.interactivityLocked = false;
    useCanvasReferenceResolutions.getState().clear();
    useNoteStore.setState({ notes: [] });
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
    renderNode(
      <LightweightNode
        {...({ selected: true, data: textNodeData() } as Parameters<typeof LightweightNode>[0])}
      />
    );
    expect(screen.getByTestId("resize-left")).toHaveAttribute("data-direction", "horizontal");
    expect(screen.getByTestId("resize-right")).toHaveAttribute("data-direction", "horizontal");
  });

  it("reveals resize controls on hover when unselected", () => {
    renderNode(
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
    renderNode(
      <LightweightNode
        {...({ selected: true, data: textNodeData() } as Parameters<typeof LightweightNode>[0])}
      />
    );
    expect(screen.queryByTestId("resize-left")).toBeNull();
    expect(screen.queryByTestId("resize-right")).toBeNull();
  });

  it("keeps connection handles above resize controls", () => {
    renderNode(
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

  it("shows the connection ports of a selected node on touch screens, larger", () => {
    renderNode(
      <LightweightNode
        {...({ selected: true, data: textNodeData() } as Parameters<typeof LightweightNode>[0])}
      />
    );
    for (const handle of screen.getAllByTestId("handle")) {
      expect(handle.className).toContain("pointer-coarse:opacity-100");
      expect(handle.className).toContain("pointer-coarse:h-5!");
      // With a mouse, ports stay a hover affordance, as before.
      expect(handle.className).toContain("group-hover:opacity-100");
    }
  });

  it("keeps the ports of an unselected node for hover only", () => {
    renderNode(
      <LightweightNode
        {...({ selected: false, data: textNodeData() } as Parameters<typeof LightweightNode>[0])}
      />
    );
    const handle = screen.getAllByTestId("handle")[0];
    expect(handle.className).toContain("group-hover:opacity-100");
    expect(handle.className).not.toContain("pointer-coarse:opacity-100");
  });

  it("hides connection ports and resize grips when interactivity is locked", () => {
    mocks.interactivityLocked = true;
    renderNode(
      <LightweightNode
        {...({ selected: true, data: textNodeData() } as Parameters<typeof LightweightNode>[0])}
      />
    );
    expect(screen.queryAllByTestId("handle")).toHaveLength(0);
    expect(screen.queryByTestId("resize-left")).toBeNull();
    expect(screen.queryByTestId("resize-right")).toBeNull();
  });

  describe("node Item Menu", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it.each([
      "text",
      "reference",
    ])("positions the %s node Item Menu beside the visible node", async (kind) => {
      const { container } = render(
        kind === "text" ? (
          <LightweightNode
            {...({ selected: false, data: textNodeData() } as Parameters<
              typeof LightweightNode
            >[0])}
          />
        ) : (
          <ReferenceNode
            {...({
              selected: false,
              data: {
                ...textNodeData(),
                node: {
                  id: "ref",
                  kind: "reference",
                  source: "note",
                  targetId: "n1",
                  label: "Linked",
                  position: { x: 0, y: 0 },
                },
              },
            } as unknown as Parameters<typeof ReferenceNode>[0])}
          />
        ),
        { wrapper: MemoryRouter }
      );
      mockItemMenuLayout(container);
      fireEvent.contextMenu(screen.getByText(kind === "text" ? "Idea" : "Linked"), {
        clientX: 400,
        clientY: 250,
      });
      const menu = await screen.findByRole("menu");
      await waitFor(() =>
        expect(menu.closest("[data-placement]")).toHaveStyle({ left: "300px", top: "384px" })
      );
    });

    it("hands off a Text Node's Item Menu to a Note Reference", async () => {
      const user = userEvent.setup();
      render(
        <>
          <LightweightNode
            {...({ selected: false, data: textNodeData() } as Parameters<
              typeof LightweightNode
            >[0])}
          />
          <ReferenceNode
            {...({
              selected: false,
              data: {
                ...textNodeData(),
                node: {
                  id: "ref",
                  kind: "reference",
                  source: "note",
                  targetId: "n1",
                  label: "Linked",
                  position: { x: 0, y: 0 },
                },
              },
            } as unknown as Parameters<typeof ReferenceNode>[0])}
          />
        </>,
        { wrapper: MemoryRouter }
      );
      await user.pointer({ target: screen.getByText("Idea"), keys: "[MouseRight]" });
      await screen.findByRole("menu");
      expect(screen.getByText("Linked").closest("[inert], [aria-hidden='true']")).toBeNull();
      await user.pointer({ target: screen.getByText("Linked"), keys: "[MouseRight]" });
      expect(screen.getAllByRole("menu")).toHaveLength(1);
      await user.click(screen.getByRole("menuitem", { name: "common.delete" }));
      expect(mocks.removeNode).toHaveBeenCalledWith("ref");
      expect(mocks.removeNode).toHaveBeenCalledTimes(1);
    });

    it("opens on touch long-press, selects the node, and connects from it", async () => {
      vi.useFakeTimers();
      renderNode(
        <LightweightNode
          {...({ selected: false, data: textNodeData() } as Parameters<typeof LightweightNode>[0])}
        />
      );

      touchLongPress(screen.getByText("Idea"));

      expect(mocks.selectNode).toHaveBeenCalledWith("node");
      touchTap(screen.getByRole("menuitem", { name: "canvas.connectTo" }));
      expect(mocks.openConnectPicker).toHaveBeenCalledWith("node");
    });

    it("opens on right click and deletes the node by keyboard", async () => {
      const user = userEvent.setup();
      render(
        <ReferenceNode
          {...({
            selected: false,
            data: {
              ...textNodeData(),
              node: {
                id: "ref",
                kind: "reference",
                source: "note",
                targetId: "n1",
                label: "Linked",
                position: { x: 0, y: 0 },
              },
            },
          } as unknown as Parameters<typeof ReferenceNode>[0])}
        />,
        { wrapper: MemoryRouter }
      );

      fireEvent.contextMenu(screen.getByText("Linked"));
      const menu = await screen.findByRole("menu", { name: "canvas.nodeActions" });
      expect(menu).toBeInTheDocument();
      // Focus moves into the menu (the menu or its first item, by input modality).
      await waitFor(() => expect(menu.contains(document.activeElement)).toBe(true));
      const deleteItem = screen.getByRole("menuitem", { name: "common.delete" });
      for (let step = 0; step < 3 && document.activeElement !== deleteItem; step++) {
        await user.keyboard("{ArrowDown}");
      }
      expect(deleteItem).toHaveFocus();
      await user.keyboard("{Enter}");

      expect(mocks.removeNode).toHaveBeenCalledWith("ref");
    });

    it("does not open while the canvas is locked", () => {
      mocks.interactivityLocked = true;
      renderNode(
        <LightweightNode
          {...({ selected: false, data: textNodeData() } as Parameters<typeof LightweightNode>[0])}
        />
      );

      fireEvent.contextMenu(screen.getByText("Idea"));

      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });
  });

  it("renders text node html without a card border/background and shows a connected stub", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderNode(
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
    renderNode(
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
    renderNode(
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
    renderNode(
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

  it("shows the stored label and disables opening when the source answers missing", () => {
    answer("note", "missing", { status: "missing" });

    renderReference(referenceData({ targetId: "missing", label: "Cached title" }));

    expect(screen.getByText("Cached title")).toBeInTheDocument();
    expect(screen.getByText("canvas.referenceMissing")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "canvas.openReferenceNamed" })).toBeDisabled();
    expect(screen.getAllByTestId("handle")).toHaveLength(4);
  });

  it("shows the stored label while the source has not answered yet", () => {
    renderReference(referenceData({ label: "Pending" }));

    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.queryByText("canvas.referenceMissing")).toBeNull();
    expect(screen.queryByText("canvas.referenceUnavailable")).toBeNull();
    expect(screen.getByRole("button", { name: "canvas.openReferenceNamed" })).toBeEnabled();
  });

  it("renders a reference from an unregistered source as unavailable", () => {
    renderReference(
      referenceData({ source: "plugin.maps.maps", targetId: "map-1", label: "Harbour map" })
    );

    expect(screen.getByText("Harbour map")).toBeInTheDocument();
    expect(screen.getByText("canvas.referenceUnavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "canvas.openReferenceNamed" })).toBeDisabled();
  });

  it("draws Present, Missing, Unavailable, and unresolved in one fixed box", () => {
    const states: Array<{
      name: string;
      seed?: () => void;
      data: ReturnType<typeof referenceData>;
    }> = [
      {
        name: "present",
        seed: () => answer("note", "note-1", { status: "present", title: "Log", value: noteRow() }),
        data: referenceData(),
      },
      {
        name: "missing",
        seed: () => answer("note", "note-1", { status: "missing" }),
        data: referenceData(),
      },
      {
        name: "unavailable",
        data: referenceData({ source: "plugin.x.y", targetId: "item-1" }),
      },
      { name: "unresolved", data: referenceData() },
    ];

    const boxes: Array<{ name: string; width: string; height: string }> = [];
    for (const state of states) {
      useCanvasReferenceResolutions.getState().clear();
      state.seed?.();
      const { container, unmount } = renderReference(state.data);
      const card = container.firstElementChild as HTMLElement;
      boxes.push({ name: state.name, width: card.style.width, height: card.style.height });
      unmount();
    }

    expect(boxes.map((box) => box.name)).toEqual([
      "present",
      "missing",
      "unavailable",
      "unresolved",
    ]);
    for (const box of boxes) {
      expect({ width: box.width, height: box.height }).toEqual({
        width: `${CANVAS_REFERENCE_CARD_SIZES.note.width}px`,
        height: `${CANVAS_REFERENCE_CARD_SIZES.note.height}px`,
      });
    }
  });

  it("disables Open for Missing and Unavailable, and enables it for unresolved and Present", () => {
    const openButton = () => screen.getByRole("button", { name: "canvas.openReferenceNamed" });

    answer("note", "note-1", { status: "present", title: "Log", value: noteRow() });
    const present = renderReference();
    expect(openButton()).toBeEnabled();
    present.unmount();

    useCanvasReferenceResolutions.getState().clear();
    answer("note", "note-1", { status: "missing" });
    const missing = renderReference();
    expect(openButton()).toBeDisabled();
    missing.unmount();

    const unavailable = renderReference(
      referenceData({ source: "plugin.x.y", targetId: "item-1" })
    );
    expect(openButton()).toBeDisabled();
    unavailable.unmount();

    useCanvasReferenceResolutions.getState().clear();
    const unresolved = renderReference();
    expect(openButton()).toBeEnabled();
    unresolved.unmount();
  });

  it("reaches Open with Tab from the card", async () => {
    const user = userEvent.setup();
    answer("note", "note-1", { status: "present", title: "Log", value: noteRow() });

    renderReference();
    await user.tab();

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "canvas.openReferenceNamed" })
    );
  });

  it("draws a Book reference in one fixed box whatever its state", () => {
    const bookData = referenceData({ source: "book", targetId: "book-1" });
    const states: Array<{ name: string; seed?: () => void }> = [
      {
        name: "present",
        seed: () =>
          answer("book", "book-1", {
            status: "present",
            title: "Harbour light",
            value: bookRow(),
          }),
      },
      { name: "missing", seed: () => answer("book", "book-1", { status: "missing" }) },
      { name: "unresolved" },
    ];

    const boxes: Array<{ name: string; width: string; height: string }> = [];
    for (const state of states) {
      useCanvasReferenceResolutions.getState().clear();
      state.seed?.();
      const { container, unmount } = renderReference(bookData);
      const card = container.firstElementChild as HTMLElement;
      boxes.push({ name: state.name, width: card.style.width, height: card.style.height });
      unmount();
    }

    expect(boxes.map((box) => box.name)).toEqual(["present", "missing", "unresolved"]);
    for (const box of boxes) {
      expect({ width: box.width, height: box.height }).toEqual({
        width: `${CANVAS_REFERENCE_CARD_SIZES.book.width}px`,
        height: `${CANVAS_REFERENCE_CARD_SIZES.book.height}px`,
      });
    }
  });

  it("draws the Library Book card's face for a Present Book reference", () => {
    answer("book", "book-1", {
      status: "present",
      title: "Harbour light",
      value: bookRow(),
    });

    renderReference(referenceData({ source: "book", targetId: "book-1" }));

    expect(screen.getByText("Harbour light")).toBeInTheDocument();
    expect(screen.getByText("Ada Reyes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "canvas.openReferenceNamed" })).toBeEnabled();
  });

  it("shows the stored label, a neutral placeholder, and a disabled Open for a Missing Book", () => {
    answer("book", "book-1", { status: "missing" });

    const { container } = renderReference(
      referenceData({ source: "book", targetId: "book-1", label: "Cached book" })
    );

    expect(screen.getByText("Cached book")).toBeInTheDocument();
    expect(screen.getByText("canvas.referenceMissing")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "canvas.openReferenceNamed" })).toBeDisabled();
    expect(container.querySelector('[aria-hidden="true"].bg-muted')).not.toBeNull();
  });

  it("reaches Open with Tab from a Present Book card", async () => {
    const user = userEvent.setup();
    answer("book", "book-1", {
      status: "present",
      title: "Harbour light",
      value: bookRow(),
    });

    renderReference(referenceData({ source: "book", targetId: "book-1" }));
    await user.tab();

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "canvas.openReferenceNamed" })
    );
  });

  it("draws a Chapter reference in one fixed box whatever its state", () => {
    const chapterData = referenceData({ source: "chapter", targetId: "chapter-1" });
    const states: Array<{ name: string; seed?: () => void }> = [
      {
        name: "present",
        seed: () =>
          answer("chapter", "chapter-1", {
            status: "present",
            title: "Harbour light",
            value: chapterRow(),
          }),
      },
      { name: "missing", seed: () => answer("chapter", "chapter-1", { status: "missing" }) },
      { name: "unresolved" },
    ];

    const boxes: Array<{ name: string; width: string; height: string }> = [];
    for (const state of states) {
      useCanvasReferenceResolutions.getState().clear();
      state.seed?.();
      const { container, unmount } = renderReference(chapterData);
      const card = container.firstElementChild as HTMLElement;
      boxes.push({ name: state.name, width: card.style.width, height: card.style.height });
      unmount();
    }

    expect(boxes.map((box) => box.name)).toEqual(["present", "missing", "unresolved"]);
    for (const box of boxes) {
      expect({ width: box.width, height: box.height }).toEqual({
        width: `${CANVAS_REFERENCE_CARD_SIZES.chapter.width}px`,
        height: `${CANVAS_REFERENCE_CARD_SIZES.chapter.height}px`,
      });
    }
  });

  it("shows a Present Chapter's title, preview, Book, and last edit with no tags", () => {
    answer("chapter", "chapter-1", {
      status: "present",
      title: "Harbour light",
      value: chapterRow(),
    });

    const { container } = renderReference(
      referenceData({ source: "chapter", targetId: "chapter-1" })
    );

    expect(screen.getByText("Harbour light")).toBeInTheDocument();
    expect(screen.getByText("Rain on the pier")).toHaveClass("line-clamp-3");
    expect(screen.getByText("The Novel")).toBeInTheDocument();
    expect(screen.getByText("notes.secondsAgo")).toBeInTheDocument();
    expect(container.querySelector(".rounded-full")).toBeNull();
    expect(screen.getByRole("button", { name: "canvas.openReferenceNamed" })).toBeEnabled();
  });

  it("shows the stored label and a disabled Open for a Missing Chapter", () => {
    answer("chapter", "chapter-1", { status: "missing" });

    renderReference(
      referenceData({ source: "chapter", targetId: "chapter-1", label: "Cached chapter" })
    );

    expect(screen.getByText("Cached chapter")).toBeInTheDocument();
    expect(screen.getByText("canvas.referenceMissing")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "canvas.openReferenceNamed" })).toBeDisabled();
  });

  it("reaches Open with Tab and answers Enter from a Present Chapter card", async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(chapterReferenceSource, "open").mockResolvedValue("opened");
    answer("chapter", "chapter-1", {
      status: "present",
      title: "Harbour light",
      value: chapterRow(),
    });

    renderReference(referenceData({ source: "chapter", targetId: "chapter-1" }));
    await user.tab();

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "canvas.openReferenceNamed" })
    );

    await user.keyboard("{Enter}");

    expect(open).toHaveBeenCalledWith(
      "chapter-1",
      expect.objectContaining({ canvasId: "canvas", canvasTitle: "Map" })
    );
  });

  it("opens through the source and turns Missing when the source says it is gone", async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(noteReferenceSource, "open").mockResolvedValue("missing");
    answer("note", "note-1", { status: "present", title: "Log", value: noteRow() });

    renderReference();
    await user.click(screen.getByRole("button", { name: "canvas.openReferenceNamed" }));

    expect(open).toHaveBeenCalledWith(
      "note-1",
      expect.objectContaining({
        canvasId: "canvas",
        canvasTitle: "Map",
        navigate: expect.any(Function),
      })
    );
    await waitFor(() => expect(screen.getByText("canvas.referenceMissing")).toBeInTheDocument());
    expect(screen.getByText("canvas.referenceUntitled")).toBeInTheDocument();
  });

  it("keeps only the start of a long note in its preview", () => {
    answer("note", "long", {
      status: "present",
      title: "Long",
      value: noteRow({ id: "long", title: "Long", content: `<p>${"word ".repeat(20000)}</p>` }),
    });

    const { container } = renderReference(referenceData({ targetId: "long" }));

    expect(container.querySelector("p")?.textContent?.length).toBeLessThanOrEqual(400);
  });

  it("answers Enter on Open right away, before the route has changed screens", async () => {
    const user = userEvent.setup();
    useNoteStore.setState({ notes: [noteRow()] });

    const { container } = renderReference();
    const open = screen.getByRole("button", { name: "canvas.openReferenceNamed" });
    expect(container.querySelector(".animate-spin")).toBeNull();

    open.focus();
    await user.keyboard("{Enter}");

    expect(container.querySelector(".animate-spin")).not.toBeNull();
    expect(open).toHaveFocus();
  });

  it("opens the note once however many times Open is pressed", async () => {
    const user = userEvent.setup();
    useNoteStore.setState({ notes: [noteRow()] });
    const visited = new Set<string>();
    function LocationProbe() {
      visited.add(useLocation().key);
      return null;
    }
    render(
      <MemoryRouter>
        <LocationProbe />
        <ReferenceNode
          {...({ selected: false, data: referenceData() } as Parameters<typeof ReferenceNode>[0])}
        />
      </MemoryRouter>
    );

    screen.getByRole("button", { name: "canvas.openReferenceNamed" }).focus();
    await user.keyboard("{Enter}");
    await user.keyboard("{Enter}");

    // The first location and the one the press pushed.
    expect(visited.size).toBe(2);
  });

  it("renders the preview for a note without a linked book", () => {
    answer("note", "note-1", {
      status: "present",
      title: "Loose note",
      value: noteRow({ title: "Loose note", content: "A long standalone note preview" }),
    });

    renderReference();

    expect(screen.getByText("Loose note")).toBeInTheDocument();
    expect(screen.getByText("A long standalone note preview")).toHaveClass("line-clamp-3");
  });

  it("shows the book title and previews a linked note the same as a loose one", () => {
    mocks.books = [bookRow({ id: "book-1", title: "The Novel" })];
    answer("note", "note-1", {
      status: "present",
      title: "Filed note",
      value: noteRow({
        bookId: "book-1",
        title: "Filed note",
        content: "A long linked note preview",
      }),
    });

    renderReference();

    expect(screen.getByText("Filed note")).toBeInTheDocument();
    expect(screen.getByText("The Novel")).toBeInTheDocument();
    expect(screen.getByText("A long linked note preview")).toHaveClass("line-clamp-3");
  });
});

afterEach(() => vi.restoreAllMocks());
