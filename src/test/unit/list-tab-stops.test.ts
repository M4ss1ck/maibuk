import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// ADR 0025: each list is one Tab stop and its row actions are reached by
// arrows. React Aria's default "arrow" behavior does exactly that. A GridList
// or Tree that opts back into keyboardNavigationBehavior="tab" turns every row
// into its own Tab stop again, so Left/Right never reach the row's buttons.
// This gate covers every list, including future call sites.
const SRC = join(process.cwd(), "src");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "test" ? [] : sourceFiles(path);
    return entry.name.endsWith(".tsx") ? [path] : [];
  });
}

function optsIntoRowTabStops(source: string): boolean {
  return /keyboardNavigationBehavior\s*=\s*"tab"/.test(source);
}

describe("list Tab stops (ADR 0025)", () => {
  it("recognizes an opted-out list and ignores React Aria's default", () => {
    expect(optsIntoRowTabStops('<GridList keyboardNavigationBehavior="tab" />')).toBe(true);
    expect(optsIntoRowTabStops('<Tree keyboardNavigationBehavior="tab" />')).toBe(true);
    expect(optsIntoRowTabStops("<GridList keyboardNavigationBehavior={behavior} />")).toBe(false);
    expect(optsIntoRowTabStops("<GridList />")).toBe(false);
  });

  it("never opts a list back into one Tab stop per row", () => {
    const offenders = sourceFiles(SRC)
      .filter((path) => optsIntoRowTabStops(readFileSync(path, "utf8")))
      .map((path) => relative(SRC, path));

    expect(offenders).toEqual([]);
  });
});
