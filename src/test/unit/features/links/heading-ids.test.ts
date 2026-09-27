import { describe, expect, it } from "vitest";
import { assignHeadingIds, deriveHeadingIds } from "@/features/links/heading-ids";

describe("assignHeadingIds", () => {
  it("assigns ids to headings that lack them and lists headings", () => {
    const result = assignHeadingIds("<h1>Intro</h1><p>x</p><h2>Details</h2>");
    expect(result.changed).toBe(true);
    expect(result.headings).toHaveLength(2);
    expect(result.headings[0]).toMatchObject({ text: "Intro", level: 1 });
    expect(result.headings[1]).toMatchObject({ text: "Details", level: 2 });
    for (const h of result.headings) {
      expect(h.id).toMatch(/^h-[a-z0-9]+$/);
      expect(result.html).toContain(`id="${h.id}"`);
    }
  });

  it("preserves existing ids and reports changed=false when all present", () => {
    const html = '<h2 id="h-keep">Stable</h2>';
    const result = assignHeadingIds(html);
    expect(result.changed).toBe(false);
    expect(result.headings[0].id).toBe("h-keep");
  });

  it("returns empty headings for content with none", () => {
    const result = assignHeadingIds("<p>no headings</p>");
    expect(result.headings).toEqual([]);
    expect(result.changed).toBe(false);
  });

  it("derives the same ids every time it reads the same content", () => {
    const html = "<h1>Intro</h1><p>x</p><h2>Details</h2>";
    expect(assignHeadingIds(html).headings.map((h) => h.id)).toEqual(
      assignHeadingIds(html).headings.map((h) => h.id)
    );
  });

  it("stores the derived ids, so a second pass changes nothing", () => {
    const first = assignHeadingIds("<h1>Intro</h1><h2>Details</h2>");
    const second = assignHeadingIds(first.html);
    expect(second.changed).toBe(false);
    expect(second.headings).toEqual(first.headings);
  });

  it("gives headings with the same text distinct ids", () => {
    const { headings } = assignHeadingIds("<h2>Notes</h2><h2>Notes</h2><h2> Notes </h2>");
    expect(new Set(headings.map((h) => h.id)).size).toBe(3);
  });

  it("keeps a derived id stable when an earlier heading gains an id", () => {
    const before = assignHeadingIds("<h1>Intro</h1><h2>Dawn</h2>").headings[1].id;
    const after = assignHeadingIds('<h1 id="h-custom">Intro</h1><h2>Dawn</h2>').headings[1].id;
    expect(after).toBe(before);
  });
});

describe("deriveHeadingIds", () => {
  it("never derives an id another heading already has", () => {
    const [derived] = deriveHeadingIds([{ id: null, text: "Dawn" }]);
    const ids = deriveHeadingIds([
      { id: derived, text: "Night" },
      { id: null, text: "Dawn" },
    ]);
    expect(ids[0]).toBe(derived);
    expect(ids[1]).not.toBe(derived);
  });
});
