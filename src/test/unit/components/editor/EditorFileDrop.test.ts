import { describe, expect, it } from "vitest";
import { buildDropHtml } from "@/components/editor/file-drop-html";

describe("buildDropHtml()", () => {
  it("concatenates converted file contents in order", () => {
    const html = buildDropHtml([
      { text: "# One", stem: "one", extension: ".md" },
      { text: "plain text", stem: "two", extension: ".txt" },
    ]);
    expect(html).toContain("<h1>One</h1>");
    expect(html).toContain("<p>plain text</p>");
    expect(html.indexOf("One")).toBeLessThan(html.indexOf("plain text"));
  });

  it("skips files that convert to nothing", () => {
    expect(
      buildDropHtml([{ text: "   ", stem: "empty", extension: ".txt" }]),
    ).toBe("");
  });
});
