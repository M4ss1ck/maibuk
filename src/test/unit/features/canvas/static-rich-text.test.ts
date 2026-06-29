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

  it("restores a line break inside empty paragraphs", () => {
    const doc = new DOMParser().parseFromString(
      prepareStaticCanvasHtml("<p>a</p><p></p>"),
      "text/html"
    );
    const paragraphs = doc.querySelectorAll("p");
    expect(paragraphs[1]?.querySelector("br")).not.toBeNull();
  });
});
