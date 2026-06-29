import { describe, expect, it } from "vitest";
import { COVER_SCHEMA_VERSION } from "@/features/covers/scene/schema";

describe("schema", () => {
  it("exposes a positive integer schema version", () => {
    expect(Number.isInteger(COVER_SCHEMA_VERSION)).toBe(true);
    expect(COVER_SCHEMA_VERSION).toBeGreaterThan(0);
  });
});
