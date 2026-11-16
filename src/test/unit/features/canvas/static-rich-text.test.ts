import { describe, expect, it } from "vitest";
import { prepareStaticCanvasHtml } from "@/features/canvas/nodes/staticRichText";

describe("prepareStaticCanvasHtml", () => {
  it("numbers footnote references from one and appends a definition section", () => {
    const html =
      '<p>One<sup data-footnote="" data-footnote-content="First note" data-footnote-id="a">*</sup>' +
      ' two<sup data-footnote="" data-footnote-content="Second note" data-footnote-id="b">*</sup></p>';
    const doc = new DOMParser().parseFromString(prepareStaticCanvasHtml(html), "text/html");

    expect(
      Array.from(doc.querySelectorAll("sup[data-footnote]")).map((r) => r.textContent)
    ).toEqual(["1", "2"]);
    expect(
      Array.from(doc.querySelectorAll(".footnote-section .footnote-content")).map(
        (item) => item.textContent
      )
    ).toEqual(["First note", "Second note"]);
  });

  it("never interprets footnote content as HTML", () => {
    const html =
      '<sup data-footnote="" data-footnote-content="<img src=x onerror=alert(1)>" data-footnote-id="a">*</sup>';
    const doc = new DOMParser().parseFromString(prepareStaticCanvasHtml(html), "text/html");
    const content = doc.querySelector(".footnote-content");
    expect(content?.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(content?.querySelector("img")).toBeNull();
  });

  it("removes script tags and unsafe link URLs", () => {
    const result = prepareStaticCanvasHtml(
      '<p>hi</p><script>alert(1)</script><a href="javascript:alert(1)">x</a>'
    );
    expect(result).not.toContain("<script");
    expect(result).not.toContain("javascript:");
  });

  it("keeps anchors in document order so a Text Node's Link index matches", () => {
    const html =
      '<p><a href="https://example.com/a">A</a><a href="maibuk://note/n1">Note</a></p>' +
      '<p><a href="https://example.com/c">C</a></p>';
    const doc = new DOMParser().parseFromString(prepareStaticCanvasHtml(html), "text/html");

    expect(Array.from(doc.querySelectorAll("a[href]")).map((anchor) => anchor.textContent)).toEqual(
      ["A", "Note", "C"]
    );
  });

  it("restores a line break inside empty paragraphs", () => {
    const doc = new DOMParser().parseFromString(
      prepareStaticCanvasHtml("<p>a</p><p></p>"),
      "text/html"
    );
    const paragraphs = doc.querySelectorAll("p");
    expect(paragraphs[1]?.querySelector("br")).not.toBeNull();
  });

  describe("an Image", () => {
    const PNG = "data:image/png;base64,iVBORw0KGgo=";
    const figure = (attrs: string, caption = "") =>
      `<figure ${attrs} data-image=""><img src="${PNG}"><figcaption>${caption}</figcaption></figure>`;
    const render = (html: string) =>
      new DOMParser()
        .parseFromString(prepareStaticCanvasHtml(html), "text/html")
        .querySelector("figure");

    // The editor's ImageView draws a figure with these classes and its width;
    // a resting node has to draw the same box, or the image changes size.
    it("keeps the size and alignment the editor gave it", () => {
      const shown = render(figure('data-alignment="left" data-width="40%"'));

      expect(shown?.className).toBe("editor-image-figure align-left");
      expect(shown?.style.width).toBe("40%");
      expect(shown?.querySelector("img")?.getAttribute("src")).toBe(PNG);
    });

    it("fills the node at center when it was never resized", () => {
      const shown = render(figure('data-alignment="center"'));

      expect(shown?.className).toBe("editor-image-figure align-center");
      expect(shown?.style.width).toBe("100%");
    });

    it("ignores a width or alignment the editor could not have written", () => {
      const shown = render(figure('data-alignment="x y" data-width="calc(100vw)"'));

      expect(shown?.className).toBe("editor-image-figure align-center");
      expect(shown?.style.width).toBe("100%");
    });

    it("shows a caption the way the editor does, and drops an empty one", () => {
      expect(
        render(figure('data-alignment="center"', "A cat"))?.querySelector("figcaption")?.className
      ).toBe("image-caption");
      expect(render(figure('data-alignment="center"'))?.querySelector("figcaption")).toBeNull();
    });
  });
});
