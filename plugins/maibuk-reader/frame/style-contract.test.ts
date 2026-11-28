/**
 * The Reader Frame's style and source contract (#943 unit 6): every shipped
 * Frame screen states its colors through `tokens.css`, never as a literal, and
 * the live chrome composes the shared kit instead of re-implementing a control.
 *
 * The rules are read from the shipped sources as text because the contract is
 * what the Frame installs, not this unit's implementation.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const plugin = join(__dirname, "..");

function read(...parts: string[]): string {
  return readFileSync(join(plugin, ...parts), "utf8");
}

/** Drops HTML comments, CSS block comments, JS line comments, and JS block comments. */
function withoutComments(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

/** A hex, rgb(), or rgba() literal; no production screen may carry one. */
const COLOR_LITERAL = /#[0-9a-f]{3,8}\b|\brgba?\(/i;

const kitDir = join(plugin, "frame", "kit");
const kitSources = readdirSync(kitDir)
  .filter((name) => name.endsWith(".tsx") && !name.endsWith(".test.tsx"))
  .sort()
  .map((name) => ({ name: `frame/kit/${name}`, source: read("frame", "kit", name) }));

const productionSources = [
  { name: "assets/ui/reader.html", source: read("assets", "ui", "reader.html") },
  { name: "assets/ui/shelf.html", source: read("assets", "ui", "shelf.html") },
  { name: "assets/ui/kit.css", source: read("assets", "ui", "kit.css") },
  { name: "assets/ui/reader.css", source: read("assets", "ui", "reader.css") },
  { name: "assets/ui/shelf.css", source: read("assets", "ui", "shelf.css") },
  { name: "frame/app.tsx", source: read("frame", "app.tsx") },
  { name: "frame/shelf.tsx", source: read("frame", "shelf.tsx") },
  ...kitSources,
];

describe("color contract", () => {
  it("keeps tokens.css as the only color-definition file", () => {
    expect(withoutComments(read("assets", "ui", "tokens.css"))).toMatch(COLOR_LITERAL);
  });

  it.each(productionSources)("states no color literal in $name", ({ source }) => {
    expect(withoutComments(source)).not.toMatch(COLOR_LITERAL);
  });
});

describe("layer order", () => {
  const css = withoutComments(read("assets", "ui", "kit.css"));

  it("keeps a plain Popover and Menu below the sheet-and-dialog layer", () => {
    const menu = css.match(/\.kit-menu\s*\{[^}]*\}/);
    const popover = css.match(/\.kit-popover\s*\{[^}]*\}/);
    expect(menu?.[0]).toMatch(/z-index:\s*var\(--z-popover\)/);
    expect(popover?.[0]).toMatch(/z-index:\s*var\(--z-popover\)/);
  });

  it("raises a nested Popover or Menu one step above the modal layer", () => {
    const rule = css.match(/\.kit-popover--nested[^{]*\{[^}]*\}/);
    expect(rule?.[0]).toContain(".kit-menu--nested");
    expect(rule?.[0]).toMatch(/z-index:\s*calc\(var\(--z-dialog\)\s*\+\s*1\)/);
  });
});

describe("the Import report and card (#948)", () => {
  const shelf = withoutComments(read("assets", "ui", "shelf.css"));

  it("caps the Wide report at 1040 px and fills a Narrow screen with its Sheet", () => {
    const dialog = shelf.match(/\.shelf-import-report \.kit-dialog\s*\{[^}]*\}/);
    const sheet = shelf.match(/\.shelf-import-report \.kit-sheet\s*\{[^}]*\}/);
    expect(dialog?.[0]).toMatch(/max-width:\s*1040px/);
    expect(sheet?.[0]).toMatch(/max-height:\s*100vh/);
  });

  it("keeps the floating Import card below the modal layers", () => {
    const card = shelf.match(/\.shelf-import-card\s*\{[^}]*\}/);
    expect(card?.[0]).toMatch(/z-index:\s*var\(--z-panel\)/);
  });
});

describe("Frame shells", () => {
  const shells = ["reader.html", "shelf.html"].map((name) => ({
    name,
    html: read("assets", "ui", name),
  }));

  it.each(shells)("links the shared Frame stylesheet and keeps $name free of styles", ({
    name,
    html,
  }) => {
    expect(html, name).toContain('<link rel="stylesheet" href="reader.css" />');
    expect(html, name).toContain('<link rel="stylesheet" href="shelf.css" />');
    expect(html, name).not.toContain("<style>");
  });

  it("ships the Shelf page as the same shell, marked for the view it draws", () => {
    const documentShell = read("assets", "ui", "reader.html");
    const shelfShell = read("assets", "ui", "shelf.html");
    const withoutView = (source: string) =>
      source.replace(/<title>[^<]*<\/title>/, "").replace(/<body[^>]*>/, "");

    expect(documentShell).toContain('<body data-view="document">');
    expect(shelfShell).toContain('<body data-view="shelf">');
    expect(shelfShell).toContain("<title>Reader Shelf</title>");
    // One shell, two views: no style or script may drift between the pages.
    expect(withoutView(shelfShell)).toBe(withoutView(documentShell));
  });

  it.each(shells)("gives $name a Shelf root inside the body, before the viewer", ({
    name,
    html,
  }) => {
    const body = html.indexOf('<div id="body">');
    const shelfRoot = html.indexOf('<div id="shelf-root"></div>');
    const viewer = html.indexOf('<main id="viewer">');
    expect(body, name).toBeGreaterThan(-1);
    expect(shelfRoot, name).toBeGreaterThan(body);
    expect(viewer, name).toBeGreaterThan(shelfRoot);
  });
});

describe("live chrome", () => {
  const app = withoutComments(read("frame", "app.tsx"));
  const reader = withoutComments(read("assets", "ui", "reader.html"));

  it("draws the shared IconButton instead of a local implementation", () => {
    expect(app).not.toMatch(/\bfunction\s+IconButton\b/);
    expect(app).not.toMatch(/\bconst\s+IconButton\b/);
  });

  it("imports the shared kit", () => {
    expect(app).toMatch(/from\s+["']\.\/kit["']/);
  });

  it("leaves no legacy icon-button rule to override the kit", () => {
    expect(reader).not.toMatch(/\.icon-button\b/);
  });
});
