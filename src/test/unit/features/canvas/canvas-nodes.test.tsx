import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateTextNode: vi.fn(),
  notes: [] as Array<{ id: string; title: string }>,
}));

vi.mock("@xyflow/react", () => ({
  Handle: () => <span data-testid="handle" />,
  Position: { Left: "left", Right: "right" },
}));

vi.mock("../../../../features/canvas/store", () => ({
  useCanvasStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ updateTextNode: mocks.updateTextNode }),
}));

vi.mock("../../../../features/notes", () => ({
  useNoteStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ notes: mocks.notes }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const { LightweightNode } = await import(
  "../../../../features/canvas/nodes/LightweightNode"
);
const { NoteRefNode } = await import("../../../../features/canvas/nodes/NoteRefNode");

describe("Canvas custom nodes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.notes = [];
  });

  it("keeps Backspace inside text editing and saves with Enter", () => {
    render(
      <LightweightNode
        {...({
          selected: false,
          data: {
            node: { id: "node", kind: "text", text: "Idea", position: { x: 0, y: 0 } },
            canvasId: "canvas",
            canvasTitle: "Map",
          },
        } as Parameters<typeof LightweightNode>[0])}
      />,
    );
    fireEvent.doubleClick(screen.getByText("Idea"));
    const input = screen.getByDisplayValue("Idea");
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(mocks.updateTextNode).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "Edited" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(mocks.updateTextNode).toHaveBeenCalledWith("node", { text: "Edited" });
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
            },
          } as Parameters<typeof NoteRefNode>[0])}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("Cached title")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "canvas.openNote" })).toBeDisabled();
  });
});
