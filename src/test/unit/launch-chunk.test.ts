import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Launch parses and holds only what the first screen needs (RAM, PR #680).
// These read the sources, because a single static import puts a whole
// screen or library back into the launch chunk without any test noticing.

const read = (path: string) => readFileSync(resolve(__dirname, "../../..", path), "utf8");

/** The specifiers a file imports statically (not `import()`, not `import type`). */
function staticImports(source: string): string[] {
  return [...source.matchAll(/^import (?!type )[^;]*?from "([^"]+)";/gms)].map((m) => m[1] ?? "");
}

describe("launch chunk", () => {
  it("App loads every screen lazily except Home and Embed", () => {
    const pages = staticImports(read("src/App.tsx")).filter((s) => s.startsWith("@/pages/"));
    expect(pages.sort()).toEqual(["@/pages/Embed", "@/pages/Home"]);
  });
});
