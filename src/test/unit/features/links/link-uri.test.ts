import { describe, expect, it } from "vitest";
import {
  parseLinkUri,
  formatLinkUri,
  isInternalLink,
  extractLinks,
} from "../../../../features/links/link-uri";

describe("link-uri", () => {
  it("formats each target type", () => {
    expect(formatLinkUri({ targetType: "note", targetId: "n1" })).toBe("maibuk://note/n1");
    expect(formatLinkUri({ targetType: "book", targetId: "b1" })).toBe("maibuk://book/b1");
    expect(formatLinkUri({ targetType: "chapter", targetId: "c1" })).toBe("maibuk://chapter/c1");
    expect(formatLinkUri({ targetType: "heading", targetId: "c1", headingId: "h-abc" })).toBe(
      "maibuk://heading/c1/h-abc",
    );
    expect(formatLinkUri({ targetType: "noteHeading", targetId: "n1", headingId: "h-note" })).toBe(
      "maibuk://note-heading/n1/h-note",
    );
  });

  it("round-trips parse(format(x)) === x", () => {
    const links = [
      { targetType: "note" as const, targetId: "n1" },
      { targetType: "heading" as const, targetId: "c1", headingId: "h-xyz" },
      { targetType: "noteHeading" as const, targetId: "n1", headingId: "h-note" },
    ];
    for (const l of links) {
      expect(parseLinkUri(formatLinkUri(l))).toEqual(l);
    }
  });

  it("rejects non-maibuk and malformed URIs", () => {
    expect(parseLinkUri("https://example.com")).toBeNull();
    expect(parseLinkUri("maibuk://heading/c1")).toBeNull(); // missing headingId
    expect(parseLinkUri("maibuk://bogus/x")).toBeNull();
    expect(isInternalLink("https://x")).toBe(false);
    expect(isInternalLink("maibuk://note/n1")).toBe(true);
  });

  it("extracts maibuk links from html with labels", () => {
    const html =
      '<p>see <a href="maibuk://note/n1">Idea</a> and ' +
      '<a class="wikilink" href="maibuk://heading/c1/h-1">Sec</a> ' +
      'and <a href="https://x.com">ext</a></p>';
    expect(extractLinks(html)).toEqual([
      { targetType: "note", targetId: "n1", label: "Idea" },
      { targetType: "heading", targetId: "c1", headingId: "h-1", label: "Sec" },
    ]);
  });
});
