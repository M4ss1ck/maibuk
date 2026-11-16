import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import StarterKit from "@tiptap/starter-kit";
import { PasteHandler } from "@/components/editor/extensions/PasteHandler";

const { mockReadCopiedImageFile, runtime } = vi.hoisted(() => ({
  mockReadCopiedImageFile: vi.fn(),
  runtime: { desktop: true },
}));

vi.mock("@/lib/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform")>()),
  get IS_DESKTOP() {
    return runtime.desktop;
  },
  getClipboard: async () => ({
    readText: vi.fn(),
    writeText: vi.fn(),
    readCopiedImageFile: mockReadCopiedImageFile,
  }),
}));

const editors: Editor[] = [];

function makeEditor() {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: [StarterKit, Image, PasteHandler],
    content: "<p>Before</p>",
  });
  editors.push(editor);
  return editor;
}

// jsdom has no DataTransfer: this keeps the shapes the paste path reads.
function paste(editor: Editor, data: Record<string, string>, files: File[] = []): Event {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      files,
      items: files.map((file) => ({ kind: "file", type: file.type, getAsFile: () => file })),
      types: [...(files.length ? ["Files"] : []), ...Object.keys(data)],
      getData: (type: string) => data[type] ?? "",
    },
  });
  editor.view.dom.dispatchEvent(event);
  return event;
}

function imageSrcs(editor: Editor): string[] {
  const srcs: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "image") srcs.push(node.attrs.src as string);
  });
  return srcs;
}

beforeEach(() => {
  mockReadCopiedImageFile.mockReset();
  runtime.desktop = true;
});

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

describe("PasteHandler image paste", () => {
  it("inserts the image file the paste carries as a data URL", async () => {
    const editor = makeEditor();

    const event = paste(editor, {}, [new File(["png"], "cat.png", { type: "image/png" })]);

    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(imageSrcs(editor)).toEqual(["data:image/png;base64,cG5n"]));
  });

  // WebKitGTK: a file-manager copy reaches the page as one empty text/uri-list.
  it("inserts the image file a file manager copied, instead of a file:// link", async () => {
    mockReadCopiedImageFile.mockResolvedValue(new Blob(["png"], { type: "image/png" }));
    const editor = makeEditor();

    const event = paste(editor, { "text/uri-list": "" });

    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(imageSrcs(editor)).toEqual(["data:image/png;base64,cG5n"]));
  });

  it("inserts nothing when the copied file is not an image", async () => {
    mockReadCopiedImageFile.mockResolvedValue(null);
    const editor = makeEditor();

    paste(editor, { "text/uri-list": "" });

    await vi.waitFor(() => expect(mockReadCopiedImageFile).toHaveBeenCalledTimes(1));
    expect(imageSrcs(editor)).toEqual([]);
    expect(editor.getHTML()).toBe("<p>Before</p>");
  });

  it("pastes text as before", () => {
    const editor = makeEditor();
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);

    paste(editor, { "text/plain": " after" });

    expect(editor.getText()).toBe("Before after");
    expect(mockReadCopiedImageFile).not.toHaveBeenCalled();
  });

  it("leaves a copied file to the page on web", () => {
    runtime.desktop = false;
    const editor = makeEditor();

    const event = paste(editor, { "text/uri-list": "" });

    // ProseMirror takes over with its own native-paste capture instead.
    expect(mockReadCopiedImageFile).not.toHaveBeenCalled();
    expect(imageSrcs(editor)).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });
});
