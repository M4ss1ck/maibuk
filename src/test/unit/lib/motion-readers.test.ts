import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// Issue #900: every JS reader of reduced motion goes through
// src/lib/motion.ts. Only that file may name the OS media query; anything else
// reads the root `data-motion` attribute the ThemeProvider sets.
const SRC = join(process.cwd(), "src");
const HELPER = join("src", "lib", "motion.ts");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "test" && directory === SRC ? [] : sourceFiles(path);
    }
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("reduced-motion readers", () => {
  it("name the OS query only in src/lib/motion.ts", () => {
    const readers = sourceFiles(SRC)
      .filter((file) => readFileSync(file, "utf8").includes("prefers-reduced-motion"))
      .map((file) => relative(process.cwd(), file).split(sep).join("/"))
      .filter((file) => file !== HELPER.replaceAll(sep, "/"));

    expect(readers).toEqual([]);
  });
});
