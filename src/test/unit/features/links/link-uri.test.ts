import { describe, expect, it } from "vitest";
import {
  parseLinkUri,
  formatLinkUri,
  isInternalLink,
  extractLinks,
} from "@/features/links/link-uri";

describe("link-uri", () => {
  it("formats each target type", () => {
    expect(formatLinkUri({ targetType: "note", targetId: "n1" })).toBe("maibuk://note/n1");
    expect(formatLinkUri({ targetType: "book", targetId: "b1" })).toBe("maibuk://book/b1");
    expect(formatLinkUri({ targetType: "chapter", targetId: "c1" })).toBe("maibuk://chapter/c1");
    expect(formatLinkUri({ targetType: "heading", targetId: "c1", headingId: "h-abc" })).toBe(
      "maibuk://heading/c1/h-abc"
    );
    expect(formatLinkUri({ targetType: "noteHeading", targetId: "n1", headingId: "h-note" })).toBe(
      "maibuk://note-heading/n1/h-note"
    );
  });

  it("round-trips parse(format(x)) === x", () => {
    const links = [
      { targetType: "note" as const, targetId: "n1" },
      { targetType: "heading" as const, targetId: "c1", headingId: "h-xyz" },
      { targetType: "noteHeading" as const, targetId: "n1", headingId: "h-note" },
      { targetType: "chapter" as const, targetId: "c1" },
      { targetType: "book" as const, targetId: "b1" },
    ];
    for (const l of links) {
      expect(parseLinkUri(formatLinkUri(l))).toEqual(l);
    }
  });

  it("percent-encodes and decodes arbitrary ids", () => {
    const tricky = "a/b c#?%";
    const link = { targetType: "heading" as const, targetId: "c1", headingId: tricky };
    const uri = formatLinkUri(link);
    // headingId segment must be encoded, not raw
    expect(uri).toBe(`maibuk://heading/c1/${encodeURIComponent(tricky)}`);
    expect(parseLinkUri(uri)).toEqual(link);
    // chapter with tricky id
    const ch = { targetType: "chapter" as const, targetId: "a/b" };
    const uri2 = formatLinkUri(ch);
    expect(uri2).toBe(`maibuk://chapter/${encodeURIComponent("a/b")}`);
    expect(parseLinkUri(uri2)).toEqual(ch);
    // noteHeading with spaces
    const nh = { targetType: "noteHeading" as const, targetId: "n 1", headingId: "h 2" };
    const uri3 = formatLinkUri(nh);
    expect(parseLinkUri(uri3)).toEqual(nh);
  });

  it("rejects non-maibuk and malformed URIs", () => {
    expect(parseLinkUri("https://example.com")).toBeNull();
    expect(parseLinkUri("maibuk://heading/c1")).toBeNull(); // missing headingId
    expect(parseLinkUri("maibuk://bogus/x")).toBeNull();
    expect(isInternalLink("https://x")).toBe(false);
    expect(isInternalLink("maibuk://note/n1")).toBe(true);
  });

  it("accepts all five valid canonical forms", () => {
    expect(parseLinkUri("maibuk://note/n1")).toEqual({ targetType: "note", targetId: "n1" });
    expect(parseLinkUri("maibuk://book/b1")).toEqual({ targetType: "book", targetId: "b1" });
    expect(parseLinkUri("maibuk://chapter/c1")).toEqual({
      targetType: "chapter",
      targetId: "c1",
    });
    expect(parseLinkUri("maibuk://heading/c1/h-abc")).toEqual({
      targetType: "heading",
      targetId: "c1",
      headingId: "h-abc",
    });
    expect(parseLinkUri("maibuk://note-heading/n1/h-1")).toEqual({
      targetType: "noteHeading",
      targetId: "n1",
      headingId: "h-1",
    });
  });

  it("rejects uppercase scheme and kind", () => {
    expect(parseLinkUri("Maibuk://note/n1")).toBeNull();
    expect(parseLinkUri("maibuk://Note/n1")).toBeNull();
    expect(parseLinkUri("maibuk://BOOK/b1")).toBeNull();
    expect(parseLinkUri("maibuk://Heading/c1/h-1")).toBeNull();
  });

  it("rejects query and fragment", () => {
    expect(parseLinkUri("maibuk://note/n1?foo=1")).toBeNull();
    expect(parseLinkUri("maibuk://note/n1#frag")).toBeNull();
    expect(parseLinkUri("maibuk://heading/c1/h-1?x")).toBeNull();
  });

  it("rejects repeated slash and trailing slash", () => {
    expect(parseLinkUri("maibuk://note//n1")).toBeNull();
    expect(parseLinkUri("maibuk://note/n1/")).toBeNull();
    expect(parseLinkUri("maibuk://heading/c1//h-1")).toBeNull();
    expect(parseLinkUri("maibuk:///note/n1")).toBeNull();
  });

  it("rejects extra segments, aliases and empty ids", () => {
    expect(parseLinkUri("maibuk://note/n1/extra")).toBeNull();
    expect(parseLinkUri("maibuk://book/b1/chapter/c1")).toBeNull();
    expect(parseLinkUri("maibuk://book/b1/chapter/c1/heading/h-1")).toBeNull();
    expect(parseLinkUri("maibuk://note/n1/heading/h-1")).toBeNull();
    expect(parseLinkUri("maibuk://notes/n1")).toBeNull();
    expect(parseLinkUri("maibuk://note_heading/n1/h-1")).toBeNull();
    expect(parseLinkUri("maibuk://")).toBeNull();
    expect(parseLinkUri("maibuk://note")).toBeNull();
    expect(parseLinkUri("")).toBeNull();
    expect(parseLinkUri("maibuk://chapter")).toBeNull();
    expect(parseLinkUri("maibuk://heading/c1")).toBeNull();
    expect(parseLinkUri("maibuk://note-heading/n1")).toBeNull();
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

  it("extracts and decodes percent-encoded ids", () => {
    const tricky = encodeURIComponent("a/b c");
    const html = `<a href="maibuk://heading/c1/${tricky}">Sec</a>`;
    expect(extractLinks(html)).toEqual([
      { targetType: "heading", targetId: "c1", headingId: "a/b c", label: "Sec" },
    ]);
  });
});
