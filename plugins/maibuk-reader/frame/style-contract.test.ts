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
  { name: "assets/ui/kit.css", source: read("assets", "ui", "kit.css") },
  { name: "frame/app.tsx", source: read("frame", "app.tsx") },
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
