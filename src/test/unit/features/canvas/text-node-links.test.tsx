import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockItemMenuLayout } from "@/test/support/item-menu-layout";
import { installPointerEvent } from "@/test/support/pointer-events";

installPointerEvent();

const mocks = vi.hoisted(() => ({
  updateTextNode: vi.fn(),
  selectNode: vi.fn(),
  removeNode: vi.fn(),
  openConnectPicker: vi.fn(),
  beginNodeEdit: vi.fn(),
  endNodeEdit: vi.fn(),
  navigate: vi.fn(),
  openExternal: vi.fn(),
  state: {} as Record<string, unknown>,
}));

vi.mock("@xyflow/react", () => ({
  Handle: () => null,
  Position: { Top: "top", Right: "right", Bottom: "bottom", Left: "left" },
  NodeResizeControl: () => null,
  ResizeControlVariant: { Line: "line", Handle: "handle" },
}));

vi.mock("../../../../features/canvas/store", () => {
  const useCanvasStore = (selector: (state: Record<string, unknown>) => unknown) =>
    selector(mocks.state);
  useCanvasStore.getState = () => mocks.state;
  return { useCanvasStore };
});

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: (key: string, options?: { text?: string }) =>
      options?.text ? `${key}:${options.text}` : key,
  }),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("../../../../lib/platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/platform")>();
  return { ...actual, openExternal: mocks.openExternal };
});

const { LightweightNode } = await import("@/features/canvas/nodes/LightweightNode");

function connectedSides() {
  return {
    top: { connected: false, incoming: false, outgoing: false },
    right: { connected: false, incoming: false, outgoing: false },
    bottom: { connected: false, incoming: false, outgoing: false },
    left: { connected: false, incoming: false, outgoing: false },
  };
}

function renderTextNode(html: string) {
  return render(
    <LightweightNode
      {...({
        selected: false,
        data: {
          node: { id: "node", kind: "text", html, position: { x: 0, y: 0 } },
          canvasId: "canvas",
          canvasTitle: "Map",
          connectedSides: connectedSides(),
        },
      } as Parameters<typeof LightweightNode>[0])}
    />
  );
}

const linkedHtml = '<p>Read <a href="https://example.com/notes">notes</a></p>';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state = {
    updateTextNode: mocks.updateTextNode,
    selectNode: mocks.selectNode,
    removeNode: mocks.removeNode,
    openConnectPicker: mocks.openConnectPicker,
    beginNodeEdit: mocks.beginNodeEdit,
    endNodeEdit: mocks.endNodeEdit,
    editingNodeId: null,
    editorReadOnly: false,
    interactivityLocked: false,
    pristineTextNode: null,
  };
});

describe("resting Text Node links", () => {
  it("opens the Link dialog when a Link is activated, and never navigates", () => {
    renderTextNode(linkedHtml);
    const link = screen.getByRole("link", { name: "notes" });

    // fireEvent returns false when the default action (browser navigation) was prevented.
    expect(fireEvent.click(link)).toBe(false);
    expect(screen.getByRole("dialog", { name: "editor.openLink" })).toBeInTheDocument();
  });

  it("ignores the click that ends a drag across the Link, so the node can move", () => {
    renderTextNode(linkedHtml);
    const link = screen.getByRole("link", { name: "notes" });

    fireEvent.pointerDown(link, { clientX: 10, clientY: 10 });
    fireEvent.click(link, { clientX: 30, clientY: 10 });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps a text selection instead of opening the Link", () => {
    renderTextNode(linkedHtml);
    const link = screen.getByRole("link", { name: "notes" });
    const range = document.createRange();
    range.selectNodeContents(link);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    fireEvent.click(link);

    expect(selection?.isCollapsed).toBe(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    selection?.removeAllRanges();
  });

  it("removes the clicked Link and saves the Text Node's HTML", async () => {
    const user = userEvent.setup();
    renderTextNode(linkedHtml);

    fireEvent.click(screen.getByRole("link", { name: "notes" }));
    await user.click(screen.getByRole("button", { name: "editor.removeLink" }));

    expect(mocks.updateTextNode).toHaveBeenCalledWith("node", {
      html: "<p>Read notes</p>",
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it.each([
    ["read-only", { editorReadOnly: true }],
    ["locked", { interactivityLocked: true }],
  ])("hides Remove while the Canvas is %s", (_label, canvasState) => {
    Object.assign(mocks.state, canvasState);
    renderTextNode(linkedHtml);

    fireEvent.click(screen.getByRole("link", { name: "notes" }));

    expect(screen.getByRole("dialog", { name: "editor.openLink" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "editor.removeLink" })).not.toBeInTheDocument();
  });

  it("opens the node menu on Shift+F10 on the focused React Flow node", async () => {
    const user = userEvent.setup();
    const { container } = render(
      // biome-ignore lint/a11y/useSemanticElements: a Canvas node wrapper is a div, as React Flow renders it.
      // biome-ignore lint/a11y/noNoninteractiveTabindex: React Flow makes that wrapper focusable so the keyboard drives the node.
      <div className="react-flow__node react-flow__node-text" role="group" tabIndex={0}>
        <LightweightNode
          {...({
            selected: false,
            data: {
              node: { id: "node", kind: "text", html: linkedHtml, position: { x: 0, y: 0 } },
              canvasId: "canvas",
              canvasTitle: "Map",
              connectedSides: connectedSides(),
            },
          } as Parameters<typeof LightweightNode>[0])}
        />
      </div>
    );
    mockItemMenuLayout(container);

    // React Flow puts focus on the node wrapper, so the keyboard gesture lands
    // there; the node's own element never sees it.
    const flowNode = screen.getByRole("group");
    flowNode.focus();
    expect(flowNode).toHaveFocus();

    await user.keyboard("{Shift>}{F10}{/Shift}");

    const menu = await screen.findByRole("menu", { name: "canvas.nodeActions" });
    expect(menu).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "editor.openLink" })).toBeInTheDocument();
  });

  it("opens Open link and Copy URL for the Link a right click landed on", async () => {
    const { container } = renderTextNode(linkedHtml);
    mockItemMenuLayout(container);

    fireEvent.contextMenu(screen.getByRole("link", { name: "notes" }));

    const menu = await screen.findByRole("menu");
    expect(menu).toBeInTheDocument();
    const open = screen.getByRole("menuitem", { name: "editor.openLink" });
    expect(screen.getByRole("menuitem", { name: "editor.copyUrl" })).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(open);
    expect(screen.getByRole("dialog", { name: "editor.openLink" })).toBeInTheDocument();
  });

  it("opens one named entry per Link when the menu opens off a Link", async () => {
    const { container } = renderTextNode(
      '<p><a href="https://example.com/read">Read</a> and <a href="https://example.com/write">Write</a></p>'
    );
    mockItemMenuLayout(container);

    fireEvent.contextMenu(screen.getByText("Read").closest("p") as HTMLParagraphElement);

    const menu = await screen.findByRole("menu");
    expect(menu).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "canvas.openLinkNamed:Read" })).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "canvas.openLinkNamed:Write" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "editor.copyUrl" })).not.toBeInTheDocument();
  });

  it("shows a single Open link entry when the Text Node holds one Link", async () => {
    const { container } = renderTextNode(linkedHtml);
    mockItemMenuLayout(container);

    fireEvent.contextMenu(screen.getByText("Read").closest("p") as HTMLParagraphElement);

    const menu = await screen.findByRole("menu");
    expect(menu).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "editor.openLink" })).toBeInTheDocument();
  });

  it("in a read-only Canvas keeps only the Link entries in the resting menu", async () => {
    mocks.state.editorReadOnly = true;
    const { container } = renderTextNode(linkedHtml);
    mockItemMenuLayout(container);

    fireEvent.contextMenu(screen.getByText("Read").closest("p") as HTMLParagraphElement);

    const menu = await screen.findByRole("menu");
    expect(menu).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "editor.openLink" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "canvas.connectTo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "common.delete" })).not.toBeInTheDocument();
  });

  it("in a read-only Canvas with no Links prevents the browser menu and opens nothing", () => {
    mocks.state.editorReadOnly = true;
    renderTextNode("<p>No links here</p>");

    const prevented = !fireEvent.contextMenu(screen.getByText("No links here"));

    expect(prevented).toBe(true);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
