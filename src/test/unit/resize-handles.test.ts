import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Every panel resize handle goes through the shared ResizeHandle, which owns
// the `cursor-col-resize` cursor along with the separator's keyboard contract.
// A hand-written handle forks that contract and can silently lose arrow-key
// support (see Notes and the BookEditor Chapter sidebar). This gate covers
// every screen, including future call sites.
const SRC = join(process.cwd(), "src");
const ALLOWED = join(SRC, "components", "ui", "ResizeHandle.tsx");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "test" ? [] : sourceFiles(path);
    return entry.name.endsWith(".tsx") ? [path] : [];
  });
}

function hasHandWrittenHandle(source: string): boolean {
  return source.includes("cursor-col-resize");
}

describe("shared ResizeHandle", () => {
  it("never hand-writes a panel resize handle outside ResizeHandle", () => {
    const offenders = sourceFiles(SRC)
      .filter((path) => path !== ALLOWED)
      .filter((path) => hasHandWrittenHandle(readFileSync(path, "utf8")))
      .map((path) => relative(SRC, path));

    expect(offenders).toEqual([]);
  });
});
