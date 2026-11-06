import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultCanvasDoc, type LightweightCanvasNode } from "@/features/canvas/types";
import { useCanvasStore } from "@/features/canvas/store";
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

const { LightweightNode } = await import("@/features/canvas/nodes/LightweightNode");

function connectedSides() {
  return {
    top: { connected: false, incoming: false, outgoing: false },
    right: { connected: false, incoming: false, outgoing: false },
    bottom: { connected: false, incoming: false, outgoing: false },
    left: { connected: false, incoming: false, outgoing: false },
  };
}

function nodeProps(node: LightweightCanvasNode) {
  return {
    selected: false,
    data: {
      node,
      canvasId: "canvas",
      canvasTitle: "Map",
      connectedSides: connectedSides(),
    },
  } as Parameters<typeof LightweightNode>[0];
}

function textNode(id: string): LightweightCanvasNode {
  return { id, kind: "text", html: `<p>${id}</p>`, position: { x: 0, y: 0 } };
}

/**
 * A Text Node inside the wrapper React Flow gives every node: `.react-flow__node`
 * is the element React Flow focuses for keyboard selection, and it is an
 * ancestor of the div the node's Item Menu is anchored to.
 */
function FlowNode({ id }: { id: string }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a Canvas node wrapper is a div, as React Flow renders it.
    // biome-ignore lint/a11y/noNoninteractiveTabindex: React Flow makes that wrapper focusable so the keyboard drives the node.
    <div className="react-flow__node" role="group" tabIndex={0} aria-label={`flow node ${id}`}>
      <LightweightNode {...nodeProps(textNode(id))} />
    </div>
  );
}

function nodeIds(): string[] {
  return useCanvasStore.getState().doc.nodes.map((node) => node.id);
}

beforeEach(() => {
  // `canvasNode.delete` and `canvasNode.connect` ship no default key
  // (src/lib/shortcut-registry.ts), so the author assigns one: the Custom
  // Shortcut is its only keyboard route, and the one these tests drive.
  useShortcutSettingsStore.setState({
    shortcuts: {
      version: 2,
      custom: {
        "canvasNode.delete": [["Mod+Shift+x"]],
        "canvasNode.connect": [["Mod+Shift+c"]],
      },
      voice: {},
      singleKeyEnabled: true,
    },
  });
  useCanvasStore.setState({
    doc: { ...createDefaultCanvasDoc(), nodes: [textNode("first"), textNode("second")] },
    current: null,
    editorReadOnly: false,
    interactivityLocked: false,
    editingNodeId: null,
    selectedNodeId: null,
    selectedEdgeId: null,
    pristineTextNode: null,
    colorPreview: null,
  });
});

describe("a Canvas node's Commands from the keyboard", () => {
  it("deletes the focused node when the React Flow wrapper holds focus", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <FlowNode id="first" />
      </MemoryRouter>
    );

    await user.tab();
    expect(screen.getByLabelText("flow node first")).toHaveFocus();

    await user.keyboard("{Control>}{Shift>}X{/Shift}{/Control}");

    expect(nodeIds()).toEqual(["second"]);
  });

  it("starts the Connect picker for the focused node when the wrapper holds focus", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <FlowNode id="first" />
      </MemoryRouter>
    );

    await user.tab();
    expect(screen.getByLabelText("flow node first")).toHaveFocus();

    await user.keyboard("{Control>}{Shift>}C{/Shift}{/Control}");

    // The Connect action (CanvasNodeMenu.tsx) arms the connection picker for
    // that node and selects it.
    expect(useCanvasStore.getState().connectSourceNodeId).toBe("first");
    expect(useCanvasStore.getState().selectedNodeId).toBe("first");
  });

  it("leaves other nodes' Commands disabled", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <FlowNode id="first" />
        <FlowNode id="second" />
      </MemoryRouter>
    );

    await user.tab();
    expect(screen.getByLabelText("flow node first")).toHaveFocus();

    await user.keyboard("{Control>}{Shift>}X{/Shift}{/Control}");

    expect(nodeIds()).toEqual(["second"]);
  });

  it("does nothing while focus is outside the node", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <button type="button">outside</button>
        <FlowNode id="first" />
      </MemoryRouter>
    );

    await user.tab();
    expect(screen.getByRole("button", { name: "outside" })).toHaveFocus();

    await user.keyboard("{Control>}{Shift>}X{/Shift}{/Control}");

    expect(nodeIds()).toEqual(["first", "second"]);
  });
});
