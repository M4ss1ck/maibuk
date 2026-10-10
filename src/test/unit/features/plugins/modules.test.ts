import { describe, expect, it } from "vitest";
import { planPluginModules, rewritePluginImports } from "@/features/plugins/modules";
import type { PluginFolderFile, PluginModulePlan } from "@/features/plugins/types";
import { sourceFolder } from "@/test/support/plugin-fixtures";

function folder(entries: Record<string, string>): PluginFolderFile[] {
  return sourceFolder(entries).files;
}

async function plan(files: PluginFolderFile[], entry = "index.js"): Promise<PluginModulePlan> {
  return planPluginModules(files, entry);
}

async function problemsOf(files: PluginFolderFile[], entry = "index.js") {
  const result = await plan(files, entry);
  if (result.ok) throw new Error("expected the plan to be refused");
  return result.problems;
}

async function codes(files: PluginFolderFile[], entry = "index.js") {
  return (await problemsOf(files, entry)).map((problem) => problem.code);
}

async function ordered(files: PluginFolderFile[]): Promise<PluginModulePlan & { ok: true }> {
  const result = await plan(files);
  if (!result.ok) throw new Error(`expected a plan, got ${JSON.stringify(result.problems)}`);
  return result;
}

describe("planPluginModules()", () => {
  it("plans a single-module entry", async () => {
    const result = await ordered(folder({ "index.js": "export const a = 1;" }));
    expect(result.modules.map((module) => module.path)).toEqual(["index.js"]);
    expect(result.modules[0].imports).toEqual([]);
  });

  it("orders dependencies before their importers and resolves relative paths", async () => {
    const result = await ordered(
      folder({
        "index.js": 'import { a } from "./lib/../lib/util.js";\nexport const b = a;',
        "lib/util.js": "export const a = 1;",
      })
    );
    expect(result.modules.map((module) => module.path)).toEqual(["lib/util.js", "index.js"]);
    expect(result.modules[1].imports).toHaveLength(1);
    expect(result.modules[1].imports[0]).toMatchObject({
      target: "lib/util.js",
      kind: "static",
    });
    const source = result.modules[1].source;
    const site = result.modules[1].imports[0];
    // A static specifier's offsets exclude the quotes.
    expect(source.slice(site.start, site.end)).toBe("./lib/../lib/util.js");
  });

  it("finds imports in export-from and literal dynamic imports", async () => {
    const result = await ordered(
      folder({
        "index.js": 'export * from "./a.js";\nimport("./b.js");',
        "a.js": "export const a = 1;",
        "b.js": "export const b = 1;",
      })
    );
    expect(result.modules.map((module) => module.path)).toEqual(["a.js", "b.js", "index.js"]);
    const entry = result.modules[2];
    // A dynamic literal's offsets cover the whole string literal.
    expect(entry.source.slice(entry.imports[1].start, entry.imports[1].end)).toBe('"./b.js"');
    expect(entry.imports[1].kind).toBe("dynamic");
  });

  it("ignores import-shaped text in strings and comments", async () => {
    const result = await ordered(
      folder({
        "index.js": 'const s = "import x from \\"./nope.js\\"";\n// import "./also-nope.js"\n',
      })
    );
    expect(result.modules).toHaveLength(1);
  });

  it("refuses a bare specifier", async () => {
    const files = folder({ "index.js": 'import React from "react";' });
    expect(await codes(files)).toEqual(["bare-import"]);
    const [problem] = await problemsOf(files);
    expect(problem.specifier).toBe("react");
    expect(problem.path).toBe("index.js");
  });

  it("refuses absolute URLs", async () => {
    expect(await codes(folder({ "index.js": 'import x from "https://example.com/x.js";' }))).toEqual(
      ["url-import"]
    );
    expect(await codes(folder({ "index.js": 'import x from "/abs.js";' }))).toEqual(["url-import"]);
    expect(await codes(folder({ "index.js": 'import x from "data:text/javascript,1";' }))).toEqual([
      "url-import",
    ]);
  });

  it("refuses a relative import that is not in the folder", async () => {
    expect(await codes(folder({ "index.js": 'import x from "./missing.js";' }))).toEqual([
      "missing-import",
    ]);
  });

  it("refuses a relative import that escapes the folder", async () => {
    expect(await codes(folder({ "index.js": 'import x from "../outside.js";' }))).toEqual([
      "missing-import",
    ]);
  });

  it("refuses a relative import that is not a module", async () => {
    const files = folder({
      "index.js": 'import data from "./data.json";',
      "data.json": "{}",
    });
    expect(await codes(files)).toEqual(["not-a-module"]);
  });

  it("refuses a dynamic import whose specifier is not a string literal", async () => {
    expect(await codes(folder({ "index.js": "const name = 'x';\nimport(name);" }))).toEqual([
      "dynamic-import",
    ]);
  });

  it("refuses an import cycle", async () => {
    const files = folder({
      "index.js": 'import "./a.js";',
      "a.js": 'import "./index.js";',
    });
    expect(await codes(files)).toEqual(["cyclic-import"]);
  });

  it("refuses a missing entry", async () => {
    expect(await codes(folder({ "other.js": "" }))).toEqual(["entry-missing"]);
  });

  it("refuses an entry that is not a module", async () => {
    expect(await codes(folder({ "index.html": "<p>hi</p>" }), "index.html")).toEqual([
      "entry-not-module",
    ]);
  });

  it("collects every problem it finds, not only the first", async () => {
    const files = folder({
      "index.js": 'import a from "react";\nimport b from "./missing.js";',
    });
    expect(await codes(files)).toEqual(["bare-import", "missing-import"]);
  });
});

describe("rewritePluginImports()", () => {
  it("replaces every specifier with its target's URL, keeping the rest of the source", async () => {
    const source = 'import a from "./a.js";\nconst s = "import(\'./a.js\')";\nimport("./b.js");';
    const result = await ordered(
      folder({ "index.js": source, "a.js": "export const a = 1;", "b.js": "export const b = 1;" })
    );
    const entry = result.modules[result.modules.length - 1];
    const urls = new Map([
      ["a.js", "blob:null/aaa"],
      ["b.js", "blob:null/bbb"],
    ]);
    const rewritten = rewritePluginImports(entry.source, entry.imports, (path) => {
      const url = urls.get(path);
      if (!url) throw new Error(`no URL for ${path}`);
      return url;
    });
    expect(rewritten).toBe(
      'import a from "blob:null/aaa";\nconst s = "import(\'./a.js\')";\nimport("blob:null/bbb");'
    );
  });
});
