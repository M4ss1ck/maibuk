import { describe, expect, it } from "vitest";
import { routeCanvasPaste } from "@/features/canvas/canvasPaste";

// jsdom has no DataTransfer: these keep the two shapes the router reads, a
// FileList-alike and a DataTransferItemList-alike.
function buildClipboard({
  files = [],
  items = [],
}: {
  files?: File[];
  items?: DataTransferItem[];
} = {}): DataTransfer {
  return { files, items } as unknown as DataTransfer;
}

function buildFile(name = "pasted.png", type = "image/png"): File {
  return new File(["image-bytes"], name, { type });
}

function buildItem(type: string, file: File | null = null): DataTransferItem {
  return { kind: file ? "file" : "string", type, getAsFile: () => file } as DataTransferItem;
}

const CENTER = { x: 10, y: 20 };
const POINTER = { x: 3, y: 4 };

function buildInput(overrides: Partial<Parameters<typeof routeCanvasPaste>[0]> = {}) {
  return {
    clipboard: buildClipboard({ files: [buildFile()] }),
    target: null,
    focused: null,
    surface: null,
    editingNodeId: null,
    readOnly: false,
    pointer: null,
    center: CENTER,
    ...overrides,
  };
}

describe("routeCanvasPaste", () => {
  it("leaves the paste to the Text Node being edited", () => {
    expect(routeCanvasPaste(buildInput({ editingNodeId: "node-1" }))).toBeNull();
  });

  it("does nothing on a read-only Canvas", () => {
    expect(routeCanvasPaste(buildInput({ readOnly: true }))).toBeNull();
  });

  it("does nothing when the paste lands in an input", () => {
    const input = document.createElement("input");
    expect(routeCanvasPaste(buildInput({ target: input }))).toBeNull();
  });

  it("does nothing when the paste lands inside a contenteditable", () => {
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    const child = document.createElement("span");
    editable.append(child);

    expect(routeCanvasPaste(buildInput({ target: child }))).toBeNull();
  });

  it("does nothing when the paste lands in a dialog open over the Canvas", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const button = document.createElement("button");
    dialog.append(button);

    expect(routeCanvasPaste(buildInput({ target: button }))).toBeNull();
  });

  it("leaves the paste to a focused editor even when the event targets the page", () => {
    const surface = document.createElement("main");
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    surface.append(editor);
    document.body.append(surface);

    expect(
      routeCanvasPaste(buildInput({ target: document.body, focused: editor, surface }))
    ).toBeNull();
    surface.remove();
  });

  it("leaves a paste whose focus is outside the Canvas surface", () => {
    const surface = document.createElement("main");
    const headerButton = document.createElement("button");
    document.body.append(surface, headerButton);

    expect(routeCanvasPaste(buildInput({ focused: headerButton, surface }))).toBeNull();
    surface.remove();
    headerButton.remove();
  });

  it("takes a paste while focus rests on the page or inside the Canvas surface", () => {
    const surface = document.createElement("main");
    const node = document.createElement("div");
    node.tabIndex = 0;
    surface.append(node);
    document.body.append(surface);

    expect(routeCanvasPaste(buildInput({ focused: document.body, surface }))).not.toBeNull();
    expect(routeCanvasPaste(buildInput({ focused: node, surface }))).not.toBeNull();
    surface.remove();
  });

  it("routes a text-only clipboard with no file for the OS clipboard to answer", () => {
    expect(
      routeCanvasPaste(
        buildInput({
          clipboard: buildClipboard({ items: [buildItem("text/plain")] }),
        })
      )
    ).toEqual({ file: null, position: CENTER });
  });

  it("routes an html-only clipboard with no file", () => {
    expect(
      routeCanvasPaste(
        buildInput({
          clipboard: buildClipboard({ items: [buildItem("text/html")] }),
        })
      )
    ).toEqual({ file: null, position: CENTER });
  });

  it("places the pasted image at the pointer when it is over the Canvas", () => {
    const file = buildFile();
    expect(
      routeCanvasPaste(
        buildInput({ clipboard: buildClipboard({ files: [file] }), pointer: POINTER })
      )
    ).toEqual({ file, position: POINTER });
  });

  it("places the pasted image at the viewport center without a pointer", () => {
    const file = buildFile();
    expect(routeCanvasPaste(buildInput({ clipboard: buildClipboard({ files: [file] }) }))).toEqual({
      file,
      position: CENTER,
    });
  });

  it("falls back to the clipboard item when files is empty", () => {
    const file = buildFile();
    expect(
      routeCanvasPaste(
        buildInput({
          clipboard: buildClipboard({ items: [buildItem("image/png", file)] }),
          pointer: POINTER,
        })
      )
    ).toEqual({ file, position: POINTER });
  });
});
