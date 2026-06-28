import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  coordsTop: 100,
  loadBooks: vi.fn(),
  transform: [0, 0, 1] as [number, number, number],
}));

vi.mock("@tiptap/react", () => ({
  useEditorState: () => ({ hasSelection: true }),
}));

vi.mock("@xyflow/react", () => ({
  useStore: (selector: (state: { transform: [number, number, number] }) => unknown) =>
    selector({ transform: mocks.transform }),
}));

vi.mock("../../../../components/editor", () => ({
  FormattingButtons: () => <button type="button">Format selection</button>,
  LinkClickHandler: () => null,
  LinkDialog: () => null,
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
  useNoteStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ notes: [] }),
}));

const { NodeFormatBubble } = await import(
  "../../../../features/canvas/nodes/NodeFormatBubble"
);

function buildEditor() {
  return {
    state: { selection: { empty: false, from: 1, to: 3 } },
    view: {
      coordsAtPos: (position: number) => ({
        top: mocks.coordsTop,
        bottom: mocks.coordsTop + 20,
        left: position === 1 ? 200 : 260,
        right: position === 1 ? 200 : 260,
      }),
      dom: document.createElement("div"),
    },
    on: vi.fn(),
    off: vi.fn(),
    commands: { focus: vi.fn() },
  };
}

describe("NodeFormatBubble", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.coordsTop = 100;
    mocks.transform = [0, 0, 1];
  });

  it("renders outside the transformed canvas node", async () => {
    const editor = buildEditor();
    render(
      <div data-testid="canvas-node" style={{ transform: "translate(40px, 30px)" }}>
        <NodeFormatBubble editor={editor as never} />
      </div>,
    );

    const button = await screen.findByRole("button", { name: "Format selection" });
    const bubble = button.parentElement;
    expect(bubble).not.toBeNull();
    await waitFor(() => {
      expect(screen.getByTestId("canvas-node")).not.toContainElement(bubble);
    });
  });

  it("repositions when the editor selection changes", async () => {
    const editor = buildEditor();
    render(<NodeFormatBubble editor={editor as never} />);

    const bubble = (await screen.findByRole("button", { name: "Format selection" }))
      .parentElement;
    expect(bubble).not.toBeNull();
    const initialTop = bubble?.style.top;

    expect(editor.on).toHaveBeenCalledWith("selectionUpdate", expect.any(Function));
    const listener = editor.on.mock.calls.find(
      ([event]) => event === "selectionUpdate",
    )?.[1] as (() => void) | undefined;
    mocks.coordsTop = 240;
    listener?.();

    await waitFor(() => expect(bubble?.style.top).not.toBe(initialTop));
  });

  it("repositions when the canvas viewport changes", async () => {
    const editor = buildEditor();
    const { rerender } = render(<NodeFormatBubble editor={editor as never} />);

    const bubble = (await screen.findByRole("button", { name: "Format selection" }))
      .parentElement;
    await waitFor(() => expect(bubble?.style.top).toBeTruthy());
    const initialTop = bubble?.style.top;

    mocks.coordsTop = 280;
    mocks.transform = [40, 30, 1.25];
    rerender(<NodeFormatBubble editor={editor as never} />);

    await waitFor(() => expect(bubble?.style.top).not.toBe(initialTop));
  });
});
