// @vitest-environment node
//
// The coverage guard `pnpm test:e2e` runs before Playwright, run here so CI
// (which runs Vitest and never Playwright) fails when a route, registry
// shortcut, or CONTEXT.md term has no matrix row, or a row has no tagged spec.

import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// The @/ alias maps to src/, so e2e/ is out of reach; a relative path is the
// only way to import the guard from a test.
import { checkCoverage } from "../../../e2e/guards/coverage";
import { collectGuardInputs } from "../../../e2e/guards/inputs";

const root = fileURLToPath(new URL("../../..", import.meta.url));

describe("E2E coverage guard", () => {
  it("covers every route, shortcut, and CONTEXT.md term with a row and a tagged spec", () => {
    const problems = checkCoverage({ ...collectGuardInputs(root), allowPlanned: false });
    const detail = problems.map((p) => `[${p.code}] ${p.message}`).join("\n");
    expect(
      problems,
      `E2E coverage guard: ${problems.length} problem(s)\n${detail}\n\nEvery new route, registry shortcut, and CONTEXT.md term needs a row in e2e/coverage-matrix.ts and a tagged spec; see AGENTS.md, E2E.`
    ).toEqual([]);
  });
});
