import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  coordsTop: 100,
  editorRectTop: 150,
  loadBooks: vi.fn(),
  transform: [0, 0, 1] as [number, number, number],
}));

vi.mock("@tiptap/react", () => ({
  useEditorState: ({
    editor,
    selector,
  }: {
    editor: unknown;
    selector: (value: { editor: unknown }) => unknown;
  }) => selector({ editor }),
}));

vi.mock("@xyflow/react", () => ({
  useStore: (selector: (state: { transform: [number, number, number] }) => unknown) =>
    selector({ transform: mocks.transform }),
}));

vi.mock("../../../../components/editor", () => ({
  FormattingButtons: ({ onLinkClick }: { onLinkClick: () => void }) => (
    <>
      <button type="button">Format selection</button>
      <button type="button" onClick={onLinkClick}>
        Insert link
      </button>
    </>
  ),
  LinkClickHandler: () => null,
  LinkDialog: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div role="dialog">Link dialog</div> : null,
}));

vi.mock("../../../../features/books/store", () => ({
  useBookStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ books: [], loadBooks: mocks.loadBooks }),
}));

vi.mock("../../../../features/chapters/store", () => ({
  getChapterForLinking: vi.fn(),
  listChaptersForBookLinking: vi.fn(),
}));

vi.mock("../../../../features/links/heading-ids", () => ({
  assignHeadingIds: () => ({ headings: [] }),
}));

vi.mock("../../../../features/notes/store", () => ({
  useNoteStore: (selector: (state: Record<string, unknown>) => unknown) => selector({ notes: [] }),
}));

vi.mock("../../../../features/canvas/nodes/CanvasRichContentMenu", () => ({
  CanvasRichContentMenu: ({
    onOverlayOpenChange,
  }: {
    onOverlayOpenChange?: (open: boolean) => void;
  }) => (
    <button type="button" onClick={() => onOverlayOpenChange?.(true)}>
      More tools
    </button>
  ),
}));

const { NodeFormatBubble } = await import("@/features/canvas/nodes/NodeFormatBubble");

function buildEditor({
  empty = false,
  isFocused = true,
}: {
  empty?: boolean;
  isFocused?: boolean;
} = {}) {
  const listeners = new Map<string, () => void>();
  const dom = document.createElement("div");
  Object.defineProperty(dom, "getBoundingClientRect", {
    value: () => ({
      top: mocks.editorRectTop,
      bottom: mocks.editorRectTop + 60,
      left: 180,
      right: 300,
      width: 120,
      height: 60,
      x: 180,
      y: mocks.editorRectTop,
      toJSON: () => ({}),
    }),
  });
  const editor = {
    isFocused,
    state: { selection: { empty, from: 1, to: empty ? 1 : 3 } },
    view: {
      coordsAtPos: (position: number) => ({
        top: mocks.coordsTop,
        bottom: mocks.coordsTop + 20,
        left: position === 1 ? 200 : 260,
        right: position === 1 ? 200 : 260,
      }),
      dom,
    },
    on: vi.fn((event: string, listener: () => void) => {
      listeners.set(event, listener);
    }),
    off: vi.fn((event: string) => {
      listeners.delete(event);
    }),
    commands: { focus: vi.fn() },
    emit(event: "focus" | "blur" | "selectionUpdate") {
      editor.isFocused = event === "focus" ? true : event === "blur" ? false : editor.isFocused;
      listeners.get(event)?.();
    },
  };
  return editor;
}

describe("NodeFormatBubble", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.coordsTop = 100;
    mocks.editorRectTop = 150;
    mocks.transform = [0, 0, 1];
  });

  it("renders outside the transformed canvas node", async () => {
    const editor = buildEditor();
    render(
      <div data-testid="canvas-node" style={{ transform: "translate(40px, 30px)" }}>
        <NodeFormatBubble editor={editor as never} />
      </div>
    );

    const button = await screen.findByRole("button", { name: "Format selection" });
    const bubble = button.parentElement;
    expect(bubble).not.toBeNull();
    await waitFor(() => {
      expect(screen.getByTestId("canvas-node")).not.toContainElement(bubble);
    });
  });

  it("shows above the editor when focused with a collapsed cursor", async () => {
    const editor = buildEditor({ empty: true, isFocused: true });
    render(<NodeFormatBubble editor={editor as never} />);

    const bubble = (await screen.findByRole("button", { name: "Format selection" })).parentElement;
    expect(bubble).toHaveStyle({ top: "102px" });
  });

  it("hides when the editor loses focus", async () => {
    const editor = buildEditor({ empty: true, isFocused: true });
    render(<NodeFormatBubble editor={editor as never} />);

    expect(await screen.findByRole("button", { name: "Format selection" })).toBeInTheDocument();
    expect(editor.on).toHaveBeenCalledWith("blur", expect.any(Function));
    editor.emit("blur");

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Format selection" })).not.toBeInTheDocument();
    });
  });

  it("hides while the insert-link dialog is open", async () => {
    const editor = buildEditor({ empty: true, isFocused: true });
    render(<NodeFormatBubble editor={editor as never} />);

    fireEvent.click(await screen.findByRole("button", { name: "Insert link" }));

    expect(screen.getByRole("dialog", { name: "" })).toHaveTextContent("Link dialog");
    expect(screen.queryByRole("button", { name: "Format selection" })).not.toBeInTheDocument();
  });

  it("notifies the parent when the link dialog opens", async () => {
    const editor = buildEditor();
    const onOverlayOpenChange = vi.fn();
    render(<NodeFormatBubble editor={editor as never} onOverlayOpenChange={onOverlayOpenChange} />);

    fireEvent.click(await screen.findByRole("button", { name: "Insert link" }));
    expect(onOverlayOpenChange).toHaveBeenCalledWith(true);
  });

  it("notifies the parent when the rich-content menu reports an overlay", async () => {
    const editor = buildEditor();
    const onOverlayOpenChange = vi.fn();
    render(<NodeFormatBubble editor={editor as never} onOverlayOpenChange={onOverlayOpenChange} />);

    fireEvent.click(await screen.findByRole("button", { name: "More tools" }));
    expect(onOverlayOpenChange).toHaveBeenCalledWith(true);
  });

  it("repositions when the editor selection changes", async () => {
    const editor = buildEditor();
    render(<NodeFormatBubble editor={editor as never} />);

    const bubble = (await screen.findByRole("button", { name: "Format selection" })).parentElement;
    expect(bubble).not.toBeNull();
    const initialTop = bubble?.style.top;

    expect(editor.on).toHaveBeenCalledWith("selectionUpdate", expect.any(Function));
    const listener = editor.on.mock.calls.find(([event]) => event === "selectionUpdate")?.[1] as
      | (() => void)
      | undefined;
    mocks.coordsTop = 240;
    listener?.();

    await waitFor(() => expect(bubble?.style.top).not.toBe(initialTop));
  });

  it("repositions when the canvas viewport changes", async () => {
    const editor = buildEditor();
    const { rerender } = render(<NodeFormatBubble editor={editor as never} />);

    const bubble = (await screen.findByRole("button", { name: "Format selection" })).parentElement;
    await waitFor(() => expect(bubble?.style.top).toBeTruthy());
    const initialTop = bubble?.style.top;

    mocks.coordsTop = 280;
    mocks.transform = [40, 30, 1.25];
    rerender(<NodeFormatBubble editor={editor as never} />);

    await waitFor(() => expect(bubble?.style.top).not.toBe(initialTop));
  });
});
