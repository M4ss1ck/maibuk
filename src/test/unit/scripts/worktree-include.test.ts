import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RUNTIMES } from "../../../../scripts/fetch-dictation-runtime.mjs";

// vendor/ is git-ignored, so a Claude Code worktree checks out without it and
// `pnpm typecheck` fails on `moonshine-wasm` (tsconfig.json paths). The
// .worktreeinclude file copies the downloaded runtimes into every new worktree.
function patterns(): string[] {
  if (!existsSync(".worktreeinclude")) return [];
  return readFileSync(".worktreeinclude", "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

describe(".worktreeinclude", () => {
  it.each(
    RUNTIMES.map((runtime) => runtime.name)
  )("copies the %s Moonshine runtime into new worktrees", (name) => {
    expect(patterns()).toContain(`vendor/moonshine/${name}/**`);
  });

  it("does not copy the downloaded models or test assets", () => {
    expect(patterns().filter((p) => p.startsWith("vendor/moonshine/models"))).toEqual([]);
    expect(patterns()).not.toContain("vendor/**");
  });

  it("covers the moonshine-wasm path the typecheck resolves", () => {
    const tsconfig = readFileSync("tsconfig.json", "utf8");
    expect(tsconfig).toContain('"./vendor/moonshine/wasm/dist/index.d.ts"');
  });
});
