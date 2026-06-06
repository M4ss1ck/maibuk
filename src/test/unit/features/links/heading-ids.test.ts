import { describe, expect, it } from "vitest";
import { assignHeadingIds } from "../../../../features/links/heading-ids";

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
});
