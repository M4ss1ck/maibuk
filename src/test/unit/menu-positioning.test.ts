import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// A native button does not consume MenuTrigger's React Aria context. Without
// an explicit triggerRef, its Popover gets no calculated CSS top/left and
// renders at the viewport origin. This gate covers every native menu anchor,
// including future call sites; browser tests prove the resulting layout.
const SRC = join(process.cwd(), "src");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "test" ? [] : sourceFiles(path);
    return entry.name.endsWith(".tsx") ? [path] : [];
  });
}

function missingAnchors(source: string): string[] {
  return [...source.matchAll(/<MenuTrigger\b[\s\S]*?<\/MenuTrigger>/g)].flatMap(([menu]) => {
    const button = menu.match(/<button\b[^>]*>/);
    if (!button) return [];
    const ref = button[0].match(/\bref=\{(\w+)\}/)?.[1];
    const popover = menu.match(/<Popover\b[^>]*>/)?.[0];
    return ref && popover?.includes(`triggerRef={${ref}}`) ? [] : [button[0]];
  });
}

describe("menu positioning contract", () => {
  it("requires an explicit positioning reference for native MenuTrigger anchors", () => {
    const violations = sourceFiles(SRC).flatMap((path) =>
      missingAnchors(readFileSync(path, "utf8")).map(
        (button) =>
          `${relative(SRC, path)}: native menu anchor needs a matching Popover triggerRef: ${button}`
      )
    );
    expect(violations).toEqual([]);
  });

  it("detects the unregistered anchor even when its fixed CSS coordinates are correct", () => {
    expect(
      missingAnchors(`
      <MenuTrigger>
        <button ref={anchor} className="fixed" style={{top: 250, left: 400}} />
        <Popover placement="bottom start"><Menu /></Popover>
      </MenuTrigger>
    `)
    ).toHaveLength(1);
  });

  it("accepts explicit native anchors and React Aria triggers", () => {
    expect(
      missingAnchors(`
      <MenuTrigger><button ref={anchor} /><Popover triggerRef={anchor} /></MenuTrigger>
      <MenuTrigger><Button /><Popover /></MenuTrigger>
    `)
    ).toEqual([]);
  });
});
