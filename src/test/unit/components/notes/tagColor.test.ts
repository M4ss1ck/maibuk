import { describe, expect, it } from "vitest";
import { tagColor } from "@/components/notes/tagColor";

describe("tagColor", () => {
  it("returns deterministic color values from the fixed palette", () => {
    expect(tagColor("draft")).toBe(tagColor("draft"));

    const palette = [
      "#60a5fa",
      "#c084fc",
      "#4ade80",
      "#fbbf24",
      "#f87171",
      "#38bdf8",
      "#a78bfa",
      "#fb923c",
      "#2dd4bf",
      "#e879f9",
      "#facc15",
      "#34d399",
      "#f472b6",
      "#818cf8",
    ];

    expect(palette).toContain(tagColor("draft"));
    expect(palette).toContain(tagColor("ideas"));
    expect(palette).toContain(tagColor("research"));
  });
});
