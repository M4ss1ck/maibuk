// @vitest-environment node
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { guardTests, readsRepoFiles } from "../../../scripts/test-guards.mjs";

const root = resolve(__dirname, "../../..");

describe("readsRepoFiles()", () => {
  it("picks a test that imports the file system", () => {
    expect(readsRepoFiles('import { readFileSync } from "node:fs";')).toBe(true);
    expect(readsRepoFiles("import { readdir } from 'node:fs/promises';")).toBe(true);
    expect(readsRepoFiles('import fs from "fs";')).toBe(true);
  });

  it("picks a test that runs an e2e guard or a repo script", () => {
    expect(readsRepoFiles('import { checkCoverage } from "../../../e2e/guards/coverage";')).toBe(
      true
    );
    expect(readsRepoFiles('import { failedTests } from "../../../scripts/test-stress.mjs";')).toBe(
      true
    );
  });

  it("leaves out a test that only imports app code", () => {
    expect(
      readsRepoFiles(
        'import { render } from "@testing-library/react";\nimport { Menu } from "@/components/ui/Menu";'
      )
    ).toBe(false);
  });
});

describe("guardTests()", () => {
  // The suite-wide guards that failed CI after a run narrowed to the touched files.
  it("includes every guard that scans the repo", () => {
    const files = guardTests(root);
    expect(files).toContain("src/test/unit/test-fixed-waits.test.ts");
    expect(files).toContain("src/test/unit/e2e-coverage-guard.test.ts");
    expect(files).toContain("src/test/unit/features/tutorial/gates.test.ts");
    expect(files).toContain("src/test/unit/test-time-budget.test.ts");
    expect(files).toContain("src/test/unit/command-coverage.test.ts");
  });

  it("leaves out tests that only render app code", () => {
    expect(guardTests(root)).not.toContain(
      "src/test/unit/components/editor/EditorContextMenu.test.tsx"
    );
  });
});
