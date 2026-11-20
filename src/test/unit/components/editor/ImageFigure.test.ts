// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";

import { ImageFigure } from "@/components/editor/extensions/ImageFigure";

const PNG = "data:image/png;base64,iVBORw0KGgo=";
let editor: Editor | null = null;

function editorWith(content: string) {
  editor = new Editor({ extensions: [StarterKit, ImageFigure], content });
  return editor;
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("ImageFigure", () => {
  it("places a new picture at the left, with no width of its own", () => {
    const e = editorWith("<p></p>");
    e.commands.insertContent({ type: "image", attrs: { src: PNG } });

    const image = e.getJSON().content?.find((node) => node.type === "image");
    expect(image?.attrs).toMatchObject({ alignment: "left", width: null });
    expect(e.getHTML()).toContain('data-alignment="left"');
    expect(e.getHTML()).not.toContain("data-width");
  });

  it("reads a pasted <img> as a left-aligned picture", () => {
    const e = editorWith(`<img src="${PNG}">`);

    expect(e.getJSON().content?.[0]?.attrs).toMatchObject({ alignment: "left" });
  });

  it("keeps the alignment and width a saved picture already has", () => {
    const e = editorWith(
      `<figure data-image="" data-alignment="center" data-width="40%"><img src="${PNG}"><figcaption></figcaption></figure>`
    );

    expect(e.getJSON().content?.[0]?.attrs).toMatchObject({ alignment: "center", width: "40%" });
  });
});
