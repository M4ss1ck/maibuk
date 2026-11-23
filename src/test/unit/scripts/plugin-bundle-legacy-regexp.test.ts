// Not every engine has the legacy `RegExp.$1` static, so a dependency
// that reads it crashes a Plugin. path-data-parser@0.1.0 (through
// rough.js) was the one such dependency in the Maps bundle; this guard reads
// the files that entry bundles, resolved from the Plugin's own folder the way
// esbuild resolves them, and fails if the legacy static is still in any of
// them, which is how the "Single continent" template broke. It reads sources
// rather than building the bundle, so the guard lane pays milliseconds.
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PLUGIN_DIR = resolve(import.meta.dirname, "../../../../plugins/maibuk-maps");

/** Resolves a specifier from the Plugin's folder, the way esbuild would. */
const pluginRequire = createRequire(join(PLUGIN_DIR, "index.tsx"));

/** Every `.js` file under `dir`. */
function jsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return jsFiles(path);
    return entry.name.endsWith(".js") ? [path] : [];
  });
}

// `roughjs/bin/generator.js` is the module the Maps scene imports, and it is
// what pulls path-data-parser in; esbuild's own resolution finds both.
const PARSER_DIR = dirname(pluginRequire.resolve("path-data-parser"));
const ROUGH_BIN_DIR = dirname(pluginRequire.resolve("roughjs/bin/generator.js"));

describe("the sources the maibuk-maps bundle is built from", () => {
  it("read no legacy RegExp statics", () => {
    const parser = readFileSync(join(PARSER_DIR, "parser.js"), "utf8");
    // The parser really is among them, so the assertion below cannot pass
    // vacuously by leaving out the dependency that had the offending code.
    expect(parser).toContain("Path data ended short");
    const offenders = [...jsFiles(PARSER_DIR), ...jsFiles(ROUGH_BIN_DIR)].filter((file) =>
      readFileSync(file, "utf8").includes("RegExp.$")
    );
    expect(offenders).toEqual([]);
  });
});
