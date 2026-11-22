import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasImageDialog } from "@/features/canvas/CanvasImageDialog";
import { CanvasImageError } from "@/features/canvas/encodeCanvasImage";
import { useCanvasStore } from "@/features/canvas/store";
import {
  createDefaultCanvasDoc,
  type CanvasNode,
  type ImageCanvasNode,
} from "@/features/canvas/types";

const { mockEncode } = vi.hoisted(() => ({ mockEncode: vi.fn() }));

vi.mock("@/features/canvas/encodeCanvasImage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/canvas/encodeCanvasImage")>();
  return { ...actual, encodeCanvasImage: mockEncode };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

function imageNode(patch: Partial<ImageCanvasNode> = {}): ImageCanvasNode {
  return {
    id: "image-1",
    kind: "image",
    src: "data:image/jpeg;base64,OLD",
    width: 400,
    height: 300,
    position: { x: 0, y: 0 },
    alt: "Old alt",
    ...patch,
  };
}

function seed(nodes: CanvasNode[] = []) {
  useCanvasStore.setState({
    doc: { ...createDefaultCanvasDoc(), nodes },
    selectedNodeId: null,
    selectedEdgeId: null,
    imageDialog: null,
    editorReadOnly: false,
    pristineTextNode: null,
  });
}

function currentImage(): ImageCanvasNode {
  const node = useCanvasStore.getState().doc.nodes[0];
  if (node?.kind !== "image") throw new Error("Expected an Image node");
  return node;
}

async function typeSource(user: ReturnType<typeof userEvent.setup>, src: string, alt?: string) {
  await user.type(screen.getByRole("textbox", { name: "editor.imageUrl" }), src);
  if (alt !== undefined) {
    await user.type(screen.getByRole("textbox", { name: "editor.altTextOptional" }), alt);
  }
  await user.click(screen.getByRole("button", { name: "common.insert" }));
}

beforeEach(() => {
  mockEncode.mockReset();
});

describe("CanvasImageDialog", () => {
  it("places the picked image fitted to the box at the target and selects it", async () => {
    const user = userEvent.setup();
    mockEncode.mockResolvedValue({ src: "data:image/jpeg;base64,NEW", width: 640, height: 480 });
    seed();
    useCanvasStore.getState().openImageDialog({ kind: "place", position: { x: 40, y: 60 } });
    render(<CanvasImageDialog />);

    await typeSource(user, "https://example.com/photos/cat%20pic.png", "A cat");

    await waitFor(() => expect(useCanvasStore.getState().imageDialog).toBeNull());
    expect(mockEncode).toHaveBeenCalledWith("https://example.com/photos/cat%20pic.png");
    const node = currentImage();
    expect(node).toMatchObject({
      src: "data:image/jpeg;base64,NEW",
      position: { x: 40, y: 60 },
      width: 320,
      height: 240,
      alt: "A cat",
      fileName: "cat pic.png",
    });
    expect(useCanvasStore.getState().selectedNodeId).toBe(node.id);
  });

  it("reports an unsupported image on the URL field and places nothing", async () => {
    const user = userEvent.setup();
    mockEncode.mockRejectedValue(new CanvasImageError("unsupported"));
    seed();
    useCanvasStore.getState().openImageDialog({ kind: "place", position: { x: 0, y: 0 } });
    render(<CanvasImageDialog />);

    await typeSource(user, "https://example.com/photo.heic");

    await screen.findByText("canvas.imageUnsupported");
    expect(useCanvasStore.getState().doc.nodes).toHaveLength(0);
    expect(useCanvasStore.getState().imageDialog).not.toBeNull();
  });

  it("places nothing when Escape cancels the dialog", async () => {
    const user = userEvent.setup();
    seed();
    useCanvasStore.getState().openImageDialog({ kind: "place", position: { x: 0, y: 0 } });
    render(<CanvasImageDialog />);

    await user.keyboard("{Escape}");

    await waitFor(() => expect(useCanvasStore.getState().imageDialog).toBeNull());
    expect(useCanvasStore.getState().doc.nodes).toHaveLength(0);
    expect(mockEncode).not.toHaveBeenCalled();
  });

  it("replaces the image, keeping the node's long edge and its alt text", async () => {
    const user = userEvent.setup();
    mockEncode.mockResolvedValue({ src: "data:image/jpeg;base64,NEW", width: 1000, height: 500 });
    seed([imageNode()]);
    useCanvasStore.getState().openImageDialog({ kind: "replace", nodeId: "image-1" });
    render(<CanvasImageDialog />);

    await typeSource(user, "https://example.com/new.jpg");

    await waitFor(() => expect(useCanvasStore.getState().imageDialog).toBeNull());
    expect(currentImage()).toMatchObject({
      src: "data:image/jpeg;base64,NEW",
      width: 400,
      height: 200,
      // A blank alt field on Replace keeps the alt text it had.
      alt: "Old alt",
    });
  });

  it("applies new alt text on Enter", async () => {
    const user = userEvent.setup();
    seed([imageNode()]);
    useCanvasStore.getState().openImageDialog({ kind: "altText", nodeId: "image-1" });
    render(<CanvasImageDialog />);

    const field = screen.getByRole("textbox", { name: "canvas.altText" });
    expect(field).toHaveValue("Old alt");
    await user.clear(field);
    await user.type(field, "A cat on a mat{Enter}");

    await waitFor(() => expect(useCanvasStore.getState().imageDialog).toBeNull());
    expect(currentImage().alt).toBe("A cat on a mat");
  });

  it("applies new alt text on Enter but not while an IME is composing", async () => {
    const user = userEvent.setup();
    seed([imageNode()]);
    useCanvasStore.getState().openImageDialog({ kind: "altText", nodeId: "image-1" });
    render(<CanvasImageDialog />);

    const field = screen.getByRole("textbox", { name: "canvas.altText" });
    await user.clear(field);
    await user.type(field, "A cat on a mat");

    fireEvent.keyDown(field, { key: "Enter", isComposing: true });
    fireEvent.keyDown(field, { key: "Enter", keyCode: 229 });
    expect(useCanvasStore.getState().imageDialog).not.toBeNull();
    expect(currentImage().alt).toBe("Old alt");

    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(useCanvasStore.getState().imageDialog).toBeNull());
    expect(currentImage().alt).toBe("A cat on a mat");
  });

  it("leaves the alt text alone when Escape cancels", async () => {
    const user = userEvent.setup();
    seed([imageNode()]);
    useCanvasStore.getState().openImageDialog({ kind: "altText", nodeId: "image-1" });
    render(<CanvasImageDialog />);

    const field = screen.getByRole("textbox", { name: "canvas.altText" });
    await user.clear(field);
    await user.type(field, "Typed but not saved");
    await user.keyboard("{Escape}");

    await waitFor(() => expect(useCanvasStore.getState().imageDialog).toBeNull());
    expect(currentImage().alt).toBe("Old alt");
  });
});
