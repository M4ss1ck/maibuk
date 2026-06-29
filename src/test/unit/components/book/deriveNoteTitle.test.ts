import { describe, expect, it } from "vitest";
import { deriveNoteTitle } from "@/components/book/deriveNoteTitle";

describe("deriveNoteTitle", () => {
  it("uses the first non-empty text line of the HTML", () => {
    expect(deriveNoteTitle("<p>First line</p><p>Second line</p>")).toBe("First line");
  });

  it("skips leading empty blocks", () => {
    expect(deriveNoteTitle("<p></p><p>  </p><p>Real title</p>")).toBe("Real title");
  });

  it("collapses whitespace and trims", () => {
    expect(deriveNoteTitle("<p>  spaced   out  </p>")).toBe("spaced out");
  });

  it("returns an empty string when there is no text", () => {
    expect(deriveNoteTitle("<p></p>")).toBe("");
  });
});
