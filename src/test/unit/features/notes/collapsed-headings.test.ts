import { describe, expect, it } from "vitest";

function parseCollapsedHeadings(raw: unknown): string[] {
  if (typeof raw !== "string" || raw.length === 0) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

describe("parseCollapsedHeadings", () => {
  it("parses a valid JSON array of strings", () => {
    expect(parseCollapsedHeadings('["abc-123","def-456"]')).toEqual(["abc-123", "def-456"]);
  });

  it("returns empty array for null", () => {
    expect(parseCollapsedHeadings(null)).toEqual([]);
  });

  it("returns empty array for undefined", () => {
    expect(parseCollapsedHeadings(undefined)).toEqual([]);
  });

  it("filters non-string values", () => {
    expect(parseCollapsedHeadings('["a",1,true,null]')).toEqual(["a"]);
  });

  it("returns empty array for invalid JSON", () => {
    expect(parseCollapsedHeadings("not json")).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(parseCollapsedHeadings("")).toEqual([]);
  });

  it("returns empty array for a non-array JSON value", () => {
    expect(parseCollapsedHeadings('"hello"')).toEqual([]);
    expect(parseCollapsedHeadings("42")).toEqual([]);
  });

  it("handles single-element array", () => {
    expect(parseCollapsedHeadings('["only-one"]')).toEqual(["only-one"]);
  });
});
