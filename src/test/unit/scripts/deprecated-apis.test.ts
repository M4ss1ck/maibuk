// @vitest-environment node
import { describe, expect, it } from "vitest";
import { deprecationProblems, isGatedFile } from "../../../../scripts/deprecated-apis.mjs";

const root = "/repo";

/** A deprecation diagnostic at the first occurrence of `needle` in `source`. */
function at(file: string, source: string, needle: string, text = `'${needle}' is deprecated.`) {
  return { fileName: `${root}/${file}`, pos: source.indexOf(needle), text, reportsDeprecated: true };
}

function problems(sources: Record<string, string>, diagnostics: ReturnType<typeof at>[]) {
  return deprecationProblems({
    root,
    files: Object.keys(sources).map((file) => `${root}/${file}`),
    diagnostics,
    readSource: (path: string) => sources[path.slice(root.length + 1)] ?? "",
  });
}

describe("isGatedFile()", () => {
  it("gates source, Plugins, scripts, and the E2E suite", () => {
    for (const file of ["src/a.ts", "plugins/echoes/index.ts", "scripts/x.mjs", "e2e/specs/a.ts"]) {
      expect(isGatedFile(file), file).toBe(true);
    }
  });

  it("leaves out dependencies, vendored code, and files outside the roots", () => {
    for (const file of [
      "node_modules/fabric/dist/index.d.ts",
      "plugins/echoes/vendor/lib.js",
      "vendor/moonshine/wasm/dist/index.d.ts",
      "vite.config.ts",
      "../elsewhere/src/a.ts",
    ]) {
      expect(isGatedFile(file), file).toBe(false);
    }
  });
});

describe("deprecationProblems()", () => {
  it("reports a deprecated use with its file, line, and column", () => {
    const source = 'import { Line } from "fabric";\nnew Line([0, 0, 1, 0]);\n';
    const diagnostic = at("src/a.ts", source, "Line([");
    expect(problems({ "src/a.ts": source }, [{ ...diagnostic, text: "'Line' is deprecated." }])).toEqual([
      "src/a.ts:2:5 'Line' is deprecated.",
    ]);
  });

  it("ignores suggestions that are not deprecations", () => {
    const source = "const unused = 1;\n";
    expect(
      problems({ "src/a.ts": source }, [{ ...at("src/a.ts", source, "unused"), reportsDeprecated: false }])
    ).toEqual([]);
  });

  it("ignores deprecations inside dependencies", () => {
    const source = "export declare const x: number;\n";
    expect(problems({}, [at("node_modules/dep/index.d.ts", source, "x")])).toEqual([]);
  });

  it("reports a use once when two projects both include its file", () => {
    const source = "el.keyCode;\n";
    const diagnostic = at("src/a.ts", source, "keyCode");
    expect(problems({ "src/a.ts": source }, [diagnostic, diagnostic])).toEqual([
      "src/a.ts:1:4 'keyCode' is deprecated.",
    ]);
  });

  it("accepts a use whose line above gives the reason it stays", () => {
    const source = "// deprecated-api: the only Safari IME signal\nel.keyCode;\n";
    expect(problems({ "src/a.ts": source }, [at("src/a.ts", source, "keyCode")])).toEqual([]);
  });

  it("rejects a marker without a reason, and the use it would cover", () => {
    const source = "  // deprecated-api:\nel.keyCode;\n";
    expect(problems({ "src/a.ts": source }, [at("src/a.ts", source, "keyCode")])).toEqual([
      "src/a.ts:1:3 deprecated-api marker needs a reason",
      "src/a.ts:2:4 'keyCode' is deprecated.",
    ]);
  });

  it("rejects a marker that no longer covers a deprecated use", () => {
    const source = "// deprecated-api: the only Safari IME signal\nel.key;\n";
    expect(problems({ "src/a.ts": source }, [])).toEqual([
      "src/a.ts:1:1 unused deprecated-api marker (nothing deprecated on the next line)",
    ]);
  });

  it("does not accept a marker two lines above the use", () => {
    const source = "// deprecated-api: the only Safari IME signal\n\nel.keyCode;\n";
    expect(problems({ "src/a.ts": source }, [at("src/a.ts", source, "keyCode")])).toEqual([
      "src/a.ts:1:1 unused deprecated-api marker (nothing deprecated on the next line)",
      "src/a.ts:3:4 'keyCode' is deprecated.",
    ]);
  });

  it("sorts problems by file and position", () => {
    const a = "x.keyCode;\ny.keyCode;\n";
    const b = "z.keyCode;\n";
    const second = { ...at("src/a.ts", a, "keyCode"), pos: a.lastIndexOf("keyCode") };
    expect(
      problems({ "src/a.ts": a, "src/b.ts": b }, [at("src/b.ts", b, "keyCode"), second, at("src/a.ts", a, "keyCode")])
    ).toEqual([
      "src/a.ts:1:3 'keyCode' is deprecated.",
      "src/a.ts:2:3 'keyCode' is deprecated.",
      "src/b.ts:1:3 'keyCode' is deprecated.",
    ]);
  });
});
