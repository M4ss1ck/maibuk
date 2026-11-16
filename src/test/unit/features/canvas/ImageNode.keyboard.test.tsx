import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCanvasStore } from "@/features/canvas/store";
import { createDefaultCanvasDoc, type ImageCanvasNode } from "@/features/canvas/types";
import { useShortcutSettingsStore } from "@/features/settings/shortcut-store";

vi.mock("@xyflow/react", () => ({
  Handle: () => null,
  Position: { Top: "top", Right: "right", Bottom: "bottom", Left: "left" },
  NodeResizeControl: () => null,
  ResizeControlVariant: { Line: "line", Handle: "handle" },
}));

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/lib/platform/detect", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform/detect")>()),
  isMac: () => false,
}));

const { ImageNode } = await import("@/features/canvas/nodes/ImageNode");

function connectedSides() {
  return {
    top: { connected: false, incoming: false, outgoing: false },
    right: { connected: false, incoming: false, outgoing: false },
    bottom: { connected: false, incoming: false, outgoing: false },
    left: { connected: false, incoming: false, outgoing: false },
  };
}

function imageNode(patch: Partial<ImageCanvasNode> = {}): ImageCanvasNode {
  return {
    id: "image",
    kind: "image",
    src: "data:image/jpeg;base64,PICTURE",
    width: 300,
    height: 200,
    position: { x: 0, y: 0 },
    ...patch,
  };
}

function nodeProps(node: ImageCanvasNode) {
  return {
    selected: false,
    data: {
      node,
      canvasId: "canvas",
      canvasTitle: "Map",
      connectedSides: connectedSides(),
    },
  } as Parameters<typeof ImageNode>[0];
}

/**
 * A Canvas Image inside the wrapper React Flow gives every node:
 * `.react-flow__node` is the element React Flow focuses for keyboard
 * selection, and it is an ancestor of the div the node's Item Menu is
 * anchored to.
 */
function FlowNode({ node }: { node: ImageCanvasNode }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a Canvas node wrapper is a div, as React Flow renders it.
    // biome-ignore lint/a11y/noNoninteractiveTabindex: React Flow makes that wrapper focusable so the keyboard drives the node.
    <div className="react-flow__node" role="group" tabIndex={0} aria-label={`flow node ${node.id}`}>
      <ImageNode {...nodeProps(node)} />
    </div>
  );
}

function storedImage(): ImageCanvasNode {
  const node = useCanvasStore.getState().doc.nodes.find((candidate) => candidate.id === "image");
  if (node?.kind !== "image") throw new Error("Expected an Image node");
  return node;
}

function imageSize(): { width: number; height: number } {
  const { width, height } = storedImage();
  return { width, height };
}

async function focusNode(user: ReturnType<typeof userEvent.setup>, id = "image") {
  await user.tab();
  expect(screen.getByLabelText(`flow node ${id}`)).toHaveFocus();
}

/** Opens the focused node's Item Menu the way a keyboard author does: Shift+F10. */
async function openItemMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard("{Shift>}{F10}{/Shift}");
  const menu = await screen.findByRole("menu", { name: "canvas.nodeActions" });
  await waitFor(() => expect(menu.contains(document.activeElement)).toBe(true));
  return menu;
}

async function chooseMenuItem(user: ReturnType<typeof userEvent.setup>, name: string) {
  await openItemMenu(user);
  const item = screen.getByRole("menuitem", { name });
  for (let step = 0; step < 8 && document.activeElement !== item; step += 1) {
    await user.keyboard("{ArrowDown}");
  }
  expect(item).toHaveFocus();
  await user.keyboard("{Enter}");
}

beforeEach(() => {
  // `canvasNode.replaceImage` and `canvasNode.editAltText` ship no default key;
  // Larger and Smaller ship "=" and "-", which need Single-key Shortcuts on.
  useShortcutSettingsStore.setState({
    shortcuts: { version: 2, custom: {}, voice: {}, singleKeyEnabled: true },
  });
  useCanvasStore.setState({
    doc: { ...createDefaultCanvasDoc(), nodes: [imageNode()] },
    current: null,
    editorReadOnly: false,
    interactivityLocked: false,
    selectedNodeId: null,
    selectedEdgeId: null,
    pristineTextNode: null,
    colorPreview: null,
    imageDialog: null,
  });
});

describe("a Canvas Image's Commands from the keyboard", () => {
  it("grows the focused Canvas Image 10% with =", async () => {
    const user = userEvent.setup();
    render(<FlowNode node={imageNode()} />);
    await focusNode(user);

    await user.keyboard("=");

    expect(imageSize()).toEqual({ width: 330, height: 220 });
  });

  it("shrinks the focused Canvas Image 10% with -", async () => {
    const user = userEvent.setup();
    render(<FlowNode node={imageNode()} />);
    await focusNode(user);

    await user.keyboard("-");

    expect(imageSize()).toEqual({ width: 273, height: 182 });
  });

  it("stops Smaller at the 48px short edge", async () => {
    const user = userEvent.setup();
    const node = imageNode({ width: 60, height: 50 });
    useCanvasStore.setState({ doc: { ...createDefaultCanvasDoc(), nodes: [node] } });
    render(<FlowNode node={node} />);
    await focusNode(user);

    await user.keyboard("-");
    expect(imageSize()).toEqual({ width: 58, height: 48 });

    await user.keyboard("-");
    expect(imageSize()).toEqual({ width: 58, height: 48 });
  });
});

describe("a Canvas Image's Item Menu from the keyboard", () => {
  it("opens Edit alt text for the focused Canvas Image", async () => {
    const user = userEvent.setup();
    render(<FlowNode node={imageNode()} />);
    await focusNode(user);

    await chooseMenuItem(user, "canvas.editAltText");

    expect(useCanvasStore.getState().imageDialog).toEqual({ kind: "altText", nodeId: "image" });
  });

  it("opens Replace image for the focused Canvas Image", async () => {
    const user = userEvent.setup();
    render(<FlowNode node={imageNode()} />);
    await focusNode(user);

    await chooseMenuItem(user, "canvas.replaceImage");

    expect(useCanvasStore.getState().imageDialog).toEqual({ kind: "replace", nodeId: "image" });
  });
});

describe("a Canvas Image's img", () => {
  it("announces the alt text, and the file name when none is set", () => {
    const { unmount } = render(<FlowNode node={imageNode({ alt: "A cat on a fence" })} />);
    expect(screen.getByRole("img", { name: "A cat on a fence" })).toBeInTheDocument();
    unmount();

    render(<FlowNode node={imageNode({ fileName: "cat.jpg" })} />);
    expect(screen.getByRole("img", { name: "cat.jpg" })).toBeInTheDocument();
  });

  it("shows the Image unavailable placeholder when the image fails to decode", () => {
    render(<FlowNode node={imageNode({ alt: "A cat" })} />);
    const image = screen.getByRole("img", { name: "A cat" });

    fireEvent.error(image);

    const placeholder = screen.getByRole("img", { name: "canvas.imageUnavailable" });
    expect(placeholder).toHaveTextContent("canvas.imageUnavailable");
    expect(screen.queryByRole("img", { name: "A cat" })).not.toBeInTheDocument();
  });
});
