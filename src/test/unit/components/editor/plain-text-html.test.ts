import { describe, expect, it } from "vitest";
import { plainTextToEditorHtml } from "../../../../components/editor/plain-text-html";

describe("plainTextToEditorHtml", () => {
  it("splits blank lines into paragraphs and single newlines into hard breaks", () => {
    expect(plainTextToEditorHtml("one\ntwo\n\nthree")).toBe("<p>one<br>two</p><p>three</p>");
  });

  it("escapes HTML-significant characters", () => {
    expect(plainTextToEditorHtml("a < b & c")).toBe("<p>a &lt; b &amp; c</p>");
  });
});
