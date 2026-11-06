import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultCanvasDoc, type LightweightCanvasNode } from "@/features/canvas/types";
import { useCanvasStore } from "@/features/canvas/store";
import { useSettingsStore } from "@/features/settings/store";
import { useSearchSwitchesStore } from "@/features/search/switches";
import { useModalStore } from "@/components/ui/modal-store";
import { useTutorialStore } from "@/features/tutorial/store";
import { runCommand } from "@/lib/command-runner";
import { forgetEditor, lastFocusedEditor } from "@/components/editor/editor-command-source";

// jsdom does not implement elementFromPoint, which ProseMirror calls during
// mousedown handling. Polyfill it to avoid uncaught exceptions.
if (typeof document.elementFromPoint === "undefined") {
  document.elementFromPoint = () => null;
}

// The shared rich-text factory includes the worker-backed spell-check extension,
// which jsdom cannot instantiate. Replace it with a no-op for these DOM tests.
vi.mock("../../../../components/editor/extensions/SpellCheck", async () => {
  const { Extension } = await vi.importActual<typeof import("@tiptap/core")>("@tiptap/core");
  return { SpellCheck: Extension.create({ name: "mockSpellCheck" }) };
});

// The Commands' labels come from the key, and a count renders its numbers.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${Object.values(options).join("/")}` : key,
    i18n: { language: "en", changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@xyflow/react", () => ({
  Handle: () => null,
  Position: { Top: "top", Right: "right", Bottom: "bottom", Left: "left" },
  NodeResizeControl: () => null,
  ResizeControlVariant: { Line: "line", Handle: "handle" },
  useStore: (selector: (state: { transform: [number, number, number] }) => unknown) =>
    selector({ transform: [0, 0, 1] }),
}));

vi.mock("../../../../features/canvas/nodes/NodeFormatBubble", () => ({
  NodeFormatBubble: () => null,
}));

vi.mock("../../../../components/editor/FootnoteList", () => ({
  FootnoteList: () => null,
}));

vi.mock("../../../../components/editor/ImageContextMenu", () => ({
  ImageContextMenu: () => null,
}));

vi.mock("../../../../components/editor/EditorContextMenu", () => ({
  EditorContextMenu: () => null,
}));

const { LightweightNode } = await import("@/features/canvas/nodes/LightweightNode");

function textNode(html = "<p>Idea</p>"): LightweightCanvasNode {
  return { id: "node", kind: "text", html, position: { x: 0, y: 0 } };
}

function connectedSides() {
  return {
    top: { connected: false, incoming: false, outgoing: false },
    right: { connected: false, incoming: false, outgoing: false },
    bottom: { connected: false, incoming: false, outgoing: false },
    left: { connected: false, incoming: false, outgoing: false },
  };
}

function renderNode(html = "<p>Idea</p>") {
  const node = textNode(html);
  return render(
    // React Flow wraps every node in this container; the Find bar portals to it.
    <MemoryRouter>
      <div className="react-flow">
        <LightweightNode
          {...({
            selected: false,
            data: {
              node,
              canvasId: "canvas",
              canvasTitle: "Map",
              connectedSides: connectedSides(),
            },
          } as Parameters<typeof LightweightNode>[0])}
        />
      </div>
    </MemoryRouter>
  );
}

/** The node's live ProseMirror contenteditable. */
function findEditor(container: HTMLElement) {
  return waitFor(() => {
    const element = container.querySelector<HTMLElement>("[contenteditable='true']");
    expect(element).not.toBeNull();
    return element as HTMLElement;
  });
}

beforeEach(() => {
  useModalStore.setState({ modalIds: [], openCount: 0, closers: {} });
  useTutorialStore.setState({ status: "idle" });
  useSearchSwitchesStore.setState({ matchCase: false, wholeWord: false, regex: false });
  useSettingsStore.setState({
    spellCheckEnabled: true,
    language: "en",
    editorAutoClose: false,
    editorOpeningMarks: false,
  });
  useCanvasStore.setState({
    doc: { ...createDefaultCanvasDoc(), nodes: [textNode()] },
    current: null,
    editorReadOnly: false,
    interactivityLocked: false,
    editingNodeId: "node",
    selectedNodeId: "node",
    selectedEdgeId: null,
    pristineTextNode: null,
    colorPreview: null,
  });
  const focused = lastFocusedEditor();
  if (focused) forgetEditor(focused);
});

describe("a Text Node's shared editor surface", () => {
  it("runs the palette's formatting Commands against its own document", async () => {
    const { container } = renderNode();
    const editor = await findEditor(container);

    const outcome = await runCommand("editor.horizontalRule", { source: "palette" });

    expect(outcome).toBe("ran");
    await waitFor(() => expect(editor.querySelector("hr")).not.toBeNull());
  });

  it("opens the Footnote dialog on Mod+Alt+N", async () => {
    const user = userEvent.setup();
    const { container } = renderNode();
    const editor = await findEditor(container);
    await user.click(editor);

    await user.keyboard("{Control>}{Alt>}n{/Alt}{/Control}");

    expect(await screen.findByRole("dialog", { name: "editor.footnote" })).toBeInTheDocument();
  });

  it("toggles Spell Check from the palette", async () => {
    const { container } = renderNode();
    await findEditor(container);
    expect(useSettingsStore.getState().spellCheckEnabled).toBe(true);

    const outcome = await runCommand("editor.spellCheck", { source: "palette" });

    expect(outcome).toBe("ran");
    expect(useSettingsStore.getState().spellCheckEnabled).toBe(false);
  });

  it("finds text, returns to the text on Escape, and leaves the node on a second Escape", async () => {
    const user = userEvent.setup();
    const { container } = renderNode();
    const editor = await findEditor(container);
    await user.click(editor);
    await user.type(editor, " edited");

    await user.keyboard("{Control>}f{/Control}");
    const find = await screen.findByPlaceholderText("editor.find");
    await waitFor(() => expect(find).toHaveFocus());

    await user.type(find, "edited");
    expect(await screen.findByText("editor.matchesOf:1/1")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByPlaceholderText("editor.find")).not.toBeInTheDocument()
    );
    await waitFor(() => expect(editor).toHaveFocus());

    await user.keyboard("{Escape}");
    await waitFor(() => expect(useCanvasStore.getState().editingNodeId).toBeNull());
    const saved = useCanvasStore.getState().doc.nodes[0];
    expect(saved.kind).toBe("text");
    expect(saved.kind === "text" ? saved.html : "").toContain("edited");
  });

  it("opens the Link dialog on Mod+K and keeps the node editing when Escape closes it", async () => {
    const user = userEvent.setup();
    const { container } = renderNode();
    const editor = await findEditor(container);
    await user.click(editor);

    await user.keyboard("{Control>}k{/Control}");
    expect(await screen.findByRole("dialog", { name: "editor.insertLink" })).toBeInTheDocument();
    expect(useCanvasStore.getState().editingNodeId).toBe("node");

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(editor).toHaveFocus());
    expect(useCanvasStore.getState().editingNodeId).toBe("node");
  });

  it("opens the Symbols dialog from the palette and keeps the node editing when Escape closes it", async () => {
    const user = userEvent.setup();
    const { container } = renderNode();
    const editor = await findEditor(container);
    await user.click(editor);

    const outcome = await runCommand("editor.insertSymbol", { source: "palette" });
    expect(outcome).toBe("ran");
    expect(await screen.findByRole("dialog", { name: "symbols.title" })).toBeInTheDocument();
    expect(useCanvasStore.getState().editingNodeId).toBe("node");

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(editor).toHaveFocus());
    expect(useCanvasStore.getState().editingNodeId).toBe("node");
  });

  it("increases the first-line indent and restores it on decrease", async () => {
    const { container } = renderNode();
    const editor = await findEditor(container);
    const before = editor.innerHTML;

    expect(await runCommand("editor.increaseFirstLineIndent", { source: "palette" })).toBe("ran");
    await waitFor(() => expect(editor.innerHTML).toContain("text-indent"));

    expect(await runCommand("editor.decreaseFirstLineIndent", { source: "palette" })).toBe("ran");
    await waitFor(() => expect(editor.innerHTML).toBe(before));
  });

  it("opens the Image dialog from the palette", async () => {
    const { container } = renderNode();
    await findEditor(container);

    expect(await runCommand("editor.insertImage", { source: "palette" })).toBe("ran");
    expect(await screen.findByRole("dialog", { name: "editor.insertImage" })).toBeInTheDocument();
  });

  it("opens the dictionary prompt from the palette when nothing is selected", async () => {
    const { container } = renderNode();
    await findEditor(container);

    expect(await runCommand("editor.dictionary", { source: "palette" })).toBe("ran");
    expect(
      await screen.findByRole("dialog", { name: "dictionary.promptTitle" })
    ).toBeInTheDocument();
  });

  it("colors the selected text from the palette", async () => {
    const user = userEvent.setup();
    const { container } = renderNode();
    const editor = await findEditor(container);
    await user.click(editor);
    // Mod+A is a ProseMirror command, so the selection lands in the editor
    // state without relying on a Shift+Arrow gesture user-event cannot make.
    await user.keyboard("{Control>}a{/Control}");

    expect(await runCommand("editor.textColor", { source: "palette" })).toBe("ran");
    await waitFor(() => expect(editor.innerHTML).toContain("rgb(0, 0, 0)"));
  });

  it("toggles Match case with Alt+C from the open Find field", async () => {
    const user = userEvent.setup();
    const { container } = renderNode();
    const editor = await findEditor(container);
    await user.click(editor);

    await user.keyboard("{Control>}f{/Control}");
    const find = await screen.findByPlaceholderText("editor.find");
    await waitFor(() => expect(find).toHaveFocus());

    await user.keyboard("{Alt>}c{/Alt}");

    expect(useSearchSwitchesStore.getState().matchCase).toBe(true);
  });

  it.each([
    "editor.exportPdf",
    "editor.viewHtml",
    "editor.toolbarSettings",
  ] as const)("reports %s as unavailable in a Text Node", async (id) => {
    const { container } = renderNode();
    await findEditor(container);

    expect(await runCommand(id, { source: "palette" })).toBe("unavailable");
  });
});
