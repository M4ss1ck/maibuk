// @vitest-environment node
import { describe, expect, it } from "vitest";
import { lintFindings } from "../../../../scripts/lint.mjs";

const clean = { errors: 0, warnings: 0, infos: 0 };

describe("lintFindings()", () => {
  it("passes a run with no errors, warnings, or infos", () => {
    expect(lintFindings(JSON.stringify({ summary: { ...clean, changed: 0 } }))).toBe(0);
  });

  // `biome check --error-on-warnings` exits 0 on infos, which is why the gate
  // reads the summary instead of the exit code.
  it("counts infos as findings", () => {
    expect(lintFindings(JSON.stringify({ summary: { ...clean, infos: 1 } }))).toBe(1);
  });

  it("adds errors, warnings, and infos", () => {
    expect(lintFindings(JSON.stringify({ summary: { errors: 2, warnings: 3, infos: 4 } }))).toBe(9);
  });

  it("treats output it cannot read as a failure", () => {
    expect(lintFindings("")).toBe(Number.POSITIVE_INFINITY);
    expect(lintFindings('{"diagnostics":[]}')).toBe(Number.POSITIVE_INFINITY);
  });
});
