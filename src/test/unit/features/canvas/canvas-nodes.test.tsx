import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateTextNode: vi.fn(),
  notes: [] as Array<{ id: string; title: string }>,
}));

vi.mock("@xyflow/react", () => ({
  Handle: () => <span data-testid="handle" />,
  Position: { Top: "top", Right: "right", Bottom: "bottom", Left: "left" },
}));

vi.mock("../../../../features/canvas/store", () => ({
  useCanvasStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ updateTextNode: mocks.updateTextNode, editorReadOnly: false }),
}));

vi.mock("../../../../features/notes", () => ({
  useNoteStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ notes: mocks.notes }),
}));

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
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
              color: "#ef4444",
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
      />,
    );
    expect(screen.getByText("Idea")).toBeInTheDocument();
    expect(document.querySelector(".bg-card")).toBeNull();
    expect(document.querySelector(".border-r-2")).not.toBeNull();
    expect(screen.getByText("Idea").closest(".group")).toHaveStyle({ color: "#ef4444" });
    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining("Duplicate extension names"),
    );
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
      />,
    );

    expect(document.querySelector("script")).toBeNull();
    expect(screen.getByRole("link", { name: "Note" })).toHaveAttribute(
      "href",
      "maibuk://note/n1",
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
      </MemoryRouter>,
    );
    expect(screen.getByText("Cached title")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "canvas.openNote" })).toBeDisabled();
    expect(screen.getAllByTestId("handle")).toHaveLength(4);
  });
});
