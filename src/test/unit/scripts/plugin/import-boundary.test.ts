// @vitest-environment node
// The import boundary an external Plugin must respect (issues #455, #450):
// only `@maibuk/plugin-sdk` (and subpaths) or a relative file inside the folder
// may be imported; `@maibuk/plugin-test-kit` stays to test files; Node builtins
// stay out of source; a private `@/`, an absolute path, another `@maibuk/`
// package, or a relative path that leaves the folder is a violation reported
// with its file, line, specifier, and reason.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkImportBoundary } from "../../../../../scripts/plugin/import-boundary";

const roots: string[] = [];

function tempPluginRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "maibuk plugin boundary "));
  roots.push(root);
  return root;
}

function write(root: string, relPath: string, text: string): void {
  const target = join(root, relPath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("checkImportBoundary()", () => {
  it("says nothing about relative files, @maibuk/plugin-sdk, and bare npm packages", () => {
    const root = tempPluginRoot();
    write(
      root,
      "index.tsx",
      [
        'import { definePlugin } from "@maibuk/plugin-sdk";',
        'import { ui } from "@maibuk/plugin-sdk/ui";',
        'import { helper } from "./helper";',
        'import React from "react";',
        'import { createRoot } from "react-dom/client";',
        "",
      ].join("\n")
    );
    write(root, "helper.ts", "export const helper = 1;\n");

    expect(checkImportBoundary(root, {}).violations).toEqual([]);
  });

  it("flags a private @/ import with its file and line", () => {
    const root = tempPluginRoot();
    write(
      root,
      "src/entry.ts",
      ["const a = 1;", 'import { thing } from "@/features/plugins/thing";', "export { a };\n"].join(
        "\n"
      )
    );

    const { violations } = checkImportBoundary(root, {});
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      file: "src/entry.ts",
      line: 2,
      specifier: "@/features/plugins/thing",
    });
    expect(violations[0].reason).toContain("@maibuk/plugin-sdk");
  });

  it("flags a relative import that leaves the Plugin folder", () => {
    const root = tempPluginRoot();
    write(root, "src/entry.ts", 'import x from "../../outside";\n');

    const { violations } = checkImportBoundary(root, {});
    expect(violations).toHaveLength(1);
    expect(violations[0].specifier).toBe("../../outside");
    expect(violations[0].reason).toMatch(/leaves the Plugin folder/);
  });

  it("flags an absolute path", () => {
    const root = tempPluginRoot();
    write(root, "entry.ts", 'import x from "/etc/passwd";\n');

    const { violations } = checkImportBoundary(root, {});
    expect(violations).toHaveLength(1);
    expect(violations[0].reason).toMatch(/absolute/);
  });

  it("flags a @maibuk package other than the SDK and the test kit", () => {
    const root = tempPluginRoot();
    write(root, "entry.ts", 'import x from "@maibuk/plugin-sdk-extra";\n');

    const { violations } = checkImportBoundary(root, {});
    expect(violations).toHaveLength(1);
    expect(violations[0].specifier).toBe("@maibuk/plugin-sdk-extra");
    expect(violations[0].reason).toMatch(/not an allowed package/);
  });

  it("refuses an SDK subpath that is not one safe segment", () => {
    const root = tempPluginRoot();
    write(root, "entry.ts", 'import x from "@maibuk/plugin-sdk/../features/plugins/broker";\n');
    write(root, "other.ts", 'import y from "@maibuk/plugin-sdk/ui/../../stores";\n');
    write(root, "third.ts", 'import z from "@maibuk/plugin-sdk/ui\\..\\escape";\n');

    const { violations } = checkImportBoundary(root, {});
    expect(violations.map((violation) => violation.specifier)).toEqual([
      "@maibuk/plugin-sdk/../features/plugins/broker",
      "@maibuk/plugin-sdk/ui/../../stores",
      "@maibuk/plugin-sdk/ui\\..\\escape",
    ]);
    for (const violation of violations) {
      expect(violation.reason).toContain("@maibuk/plugin-sdk");
    }
  });

  it("allows a single-segment SDK subpath", () => {
    const root = tempPluginRoot();
    write(root, "entry.ts", 'import { ui } from "@maibuk/plugin-sdk/ui";\n');
    write(root, "other.ts", 'import { api } from "@maibuk/plugin-sdk/api.generated";\n');

    expect(checkImportBoundary(root, {}).violations).toEqual([]);
  });

  it("allows @maibuk/plugin-test-kit only in test files", () => {
    const root = tempPluginRoot();
    write(root, "entry.ts", 'import { host } from "@maibuk/plugin-test-kit";\n');
    write(root, "entry.test.ts", 'import { host } from "@maibuk/plugin-test-kit";\n');
    write(root, "test-support.ts", 'import { host } from "@maibuk/plugin-test-kit";\n');

    const { violations } = checkImportBoundary(root, {});
    expect(violations).toHaveLength(1);
    expect(violations[0].file).toBe("entry.ts");
    expect(violations[0].reason).toMatch(/test files/);
  });

  it("keeps Node builtins out of source but allows them in tests", () => {
    const root = tempPluginRoot();
    write(root, "entry.ts", 'import { readFileSync } from "node:fs";\n');
    write(root, "other.ts", 'import path from "path";\n');
    write(root, "entry.test.ts", 'import { readFileSync } from "node:fs";\n');
    write(root, "helper.test.ts", 'import { join } from "path";\n');

    const { violations } = checkImportBoundary(root, {});
    expect(violations.map((violation) => violation.file).sort()).toEqual(["entry.ts", "other.ts"]);
    for (const violation of violations) {
      expect(violation.reason).toMatch(/builtin/i);
    }
  });

  it("finds static, side-effect, dynamic, export-from, and require specifiers", () => {
    const root = tempPluginRoot();
    write(
      root,
      "entry.ts",
      [
        'import "@/side-effect";',
        'export { thing } from "@/re-export";',
        'const dynamic = await import("@/dynamic");',
        'const required = require("@/required");',
        "export { dynamic, required };\n",
      ].join("\n")
    );

    const { violations } = checkImportBoundary(root, {});
    expect(violations.map((violation) => violation.specifier)).toEqual([
      "@/side-effect",
      "@/re-export",
      "@/dynamic",
      "@/required",
    ]);
    expect(violations.map((violation) => violation.line)).toEqual([1, 2, 3, 4]);
  });

  it("prunes node_modules, dist, .git, .maibuk, and the root-level scripts/", () => {
    const root = tempPluginRoot();
    write(root, "entry.ts", "export const ok = 1;\n");
    write(root, "node_modules/pkg/index.ts", 'import "@/nope";\n');
    write(root, "src/node_modules/pkg/deep.mjs", 'import "@/nope";\n');
    write(root, "dist/bundle.js", 'import "@/nope";\n');
    write(root, "src/dist/bundle.js", 'import "@/nope";\n');
    write(root, ".git/hooks/pre-commit.js", 'import "@/nope";\n');
    write(root, ".maibuk/tsconfig.paths.json", 'import "@/nope";\n');
    write(root, "scripts/setup.mjs", 'import "@/nope";\n');

    const { violations, scanned } = checkImportBoundary(root, {});
    expect(violations).toEqual([]);
    expect(scanned).toEqual(["entry.ts"]);
  });

  it("scans .mts, .cts, and .cjs files", () => {
    const root = tempPluginRoot();
    write(root, "a.mts", 'import x from "@/a";\n');
    write(root, "b.cts", 'import x from "@/b";\n');
    write(root, "c.cjs", 'const x = require("@/c");\n');

    const { violations, scanned } = checkImportBoundary(root, {});
    expect(scanned).toEqual(["a.mts", "b.cts", "c.cjs"]);
    expect(violations.map((violation) => violation.specifier)).toEqual(["@/a", "@/b", "@/c"]);
  });

  it("allows a deep import into a bare npm package", () => {
    const root = tempPluginRoot();
    write(root, "entry.ts", 'import x from "some-lib/src/x";\n');

    expect(checkImportBoundary(root, {}).violations).toEqual([]);
  });

  it("refuses the maibuk package itself as reaching into the checkout", () => {
    const root = tempPluginRoot();
    write(root, "entry.ts", 'import x from "maibuk";\n');
    write(root, "other.ts", 'import y from "maibuk/src/features/plugins";\n');

    const { violations } = checkImportBoundary(root, {});
    expect(violations.map((violation) => violation.specifier)).toEqual([
      "maibuk",
      "maibuk/src/features/plugins",
    ]);
    for (const violation of violations) {
      expect(violation.reason).toBe(`${violation.specifier} reaches into the Maibuk checkout`);
    }
  });

  it("refuses a relative import that resolves inside maibukRoot with the specific reason", () => {
    const parent = tempPluginRoot();
    const pluginRoot = join(parent, "plugin");
    const maibukRoot = join(parent, "maibuk");
    mkdirSync(pluginRoot, { recursive: true });
    mkdirSync(join(maibukRoot, "src"), { recursive: true });
    write(pluginRoot, "entry.ts", 'import x from "../maibuk/src/thing";\n');

    const { violations } = checkImportBoundary(pluginRoot, { maibukRoot });
    expect(violations).toHaveLength(1);
    expect(violations[0].reason).toBe("../maibuk/src/thing reaches into the Maibuk checkout");
  });

  it("keeps the leaves-the-folder reason for a relative import outside maibukRoot", () => {
    const parent = tempPluginRoot();
    const pluginRoot = join(parent, "plugin");
    mkdirSync(pluginRoot, { recursive: true });
    mkdirSync(join(parent, "maibuk"), { recursive: true });
    write(pluginRoot, "entry.ts", 'import x from "../elsewhere";\n');

    const { violations } = checkImportBoundary(pluginRoot, { maibukRoot: join(parent, "maibuk") });
    expect(violations).toHaveLength(1);
    expect(violations[0].reason).toBe("../elsewhere leaves the Plugin folder");
  });

  it("returns the scanned files as sorted, forward-slash relative paths", () => {
    const root = tempPluginRoot();
    write(root, "src/a.tsx", "export const a = 1;\n");
    write(root, "index.ts", "export const b = 2;\n");

    expect(checkImportBoundary(root, {}).scanned).toEqual(["index.ts", "src/a.tsx"]);
  });
});
