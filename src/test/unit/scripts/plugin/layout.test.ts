// @vitest-environment node
// The layout a packaged Plugin must have (issue #455). The same rules run on a
// built folder and on its `.zip`: the manifest sits at the root, every file the
// manifest declares is present, nothing a package must never ship is inside
// (source, source maps, tests, node_modules), and no file leaks an absolute
// path the caller forbids.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { packagePlugin } from "../../../../../scripts/plugin/package";
import { checkFolderLayout, checkPackageLayout } from "../../../../../scripts/plugin/layout";

const roots: string[] = [];

function tempDir(prefix = "maibuk layout "): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function write(root: string, relPath: string, text: string): void {
  const target = join(root, relPath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
}

interface ManifestOverrides {
  entry?: string;
  frame?: string;
  icon?: string;
}

/** A schema-shaped manifest whose entry, page frame, and .svg icon are declared files. */
function manifestText(overrides: ManifestOverrides = {}): string {
  return `${JSON.stringify(
    {
      manifestVersion: 1,
      id: "sample",
      name: "Sample",
      description: "A sample Plugin.",
      author: "Tester",
      version: "1.0.0",
      apiVersion: "^1.0",
      entry: overrides.entry ?? "index.js",
      platforms: ["web"],
      lifecycle: "on-demand",
      defaultLanguage: "en",
      permissions: { required: [], optional: [] },
      customUi: true,
      contributes: {
        commands: [{ id: "open", label: "Open", contexts: ["global"], navigates: true }],
        pages: [
          {
            id: "report",
            title: "Report",
            command: "open",
            frame: overrides.frame ?? "ui/report.html",
          },
        ],
        sidebarEntries: [{ page: "report", icon: overrides.icon ?? "icons/echo.svg" }],
        toolbarButtons: [{ id: "run", command: "open", icon: "highlighter" }],
      },
    },
    null,
    2
  )}\n`;
}

/** A built Plugin folder that passes every layout rule. */
function makeGoodFolder(): string {
  const root = tempDir("maibuk plugin ");
  write(root, "manifest.json", manifestText());
  write(root, "index.js", "export const x = 1;\n");
  write(root, "ui/report.html", "<!doctype html><title>Report</title>\n");
  write(root, "icons/echo.svg", "<svg></svg>\n");
  write(root, "locales/en.json", `${JSON.stringify({ name: "Sample" })}\n`);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("checkFolderLayout()", () => {
  it("passes a folder whose declared files are all present", () => {
    expect(checkFolderLayout(makeGoodFolder(), { forbiddenStrings: [] }).problems).toEqual([]);
  });

  it("reports a missing manifest.json", () => {
    const folder = makeGoodFolder();
    rmSync(join(folder, "manifest.json"));

    const { problems } = checkFolderLayout(folder, { forbiddenStrings: [] });
    expect(problems.some((problem) => problem.includes("manifest.json is missing"))).toBe(true);
  });

  it("reports a missing entry", () => {
    const folder = makeGoodFolder();
    rmSync(join(folder, "index.js"));

    const { problems } = checkFolderLayout(folder, { forbiddenStrings: [] });
    expect(problems).toContain('declared file "index.js" is missing');
  });

  it("reports a missing page frame", () => {
    const folder = makeGoodFolder();
    rmSync(join(folder, "ui/report.html"));

    const { problems } = checkFolderLayout(folder, { forbiddenStrings: [] });
    expect(problems).toContain('declared file "ui/report.html" is missing');
  });

  it("reports a missing .svg icon", () => {
    const folder = makeGoodFolder();
    rmSync(join(folder, "icons/echo.svg"));

    const { problems } = checkFolderLayout(folder, { forbiddenStrings: [] });
    expect(problems).toContain('declared file "icons/echo.svg" is missing');
  });

  it("treats a Lucide icon name as an icon, not a file", () => {
    const folder = tempDir("maibuk plugin ");
    write(folder, "manifest.json", manifestText({ icon: "waves" }));
    write(folder, "index.js", "export const x = 1;\n");
    write(folder, "ui/report.html", "<!doctype html>\n");

    expect(checkFolderLayout(folder, { forbiddenStrings: [] }).problems).toEqual([]);
  });

  it("refuses source files, source maps, and test files", () => {
    const folder = makeGoodFolder();
    write(folder, "src/extra.ts", "export const extra = 1;\n");
    write(folder, "index.js.map", "{}\n");
    write(folder, "entry.test.ts", "export {};\n");

    const { problems } = checkFolderLayout(folder, { forbiddenStrings: [] });
    expect(problems.some((problem) => problem.includes("src/extra.ts"))).toBe(true);
    expect(problems.some((problem) => problem.includes("index.js.map"))).toBe(true);
    expect(problems.some((problem) => problem.includes("entry.test.ts"))).toBe(true);
  });

  it("refuses a node_modules folder", () => {
    const folder = makeGoodFolder();
    write(folder, "node_modules/pkg/index.js", "module.exports = {};\n");

    const { problems } = checkFolderLayout(folder, { forbiddenStrings: [] });
    expect(problems.some((problem) => problem.includes("node_modules"))).toBe(true);
  });

  it("refuses a file that leaks a forbidden absolute path", () => {
    const folder = makeGoodFolder();
    const checkout = "/home/author/src/maibuk";
    write(folder, "index.js", `export const checkout = ${JSON.stringify(checkout)};\n`);

    const { problems } = checkFolderLayout(folder, { forbiddenStrings: [checkout] });
    expect(problems).toContain(`"index.js" contains the forbidden path "${checkout}"`);
  });
});

describe("checkPackageLayout()", () => {
  it("passes the zip of a good folder", async () => {
    const folder = makeGoodFolder();
    const zipPath = join(tempDir("maibuk out "), "plugin.zip");
    await packagePlugin(folder, zipPath);

    expect(checkPackageLayout(zipPath, { forbiddenStrings: [] }).problems).toEqual([]);
  });

  it("applies the same rules to the zip", async () => {
    const folder = makeGoodFolder();
    write(folder, "src/extra.ts", "export const extra = 1;\n");
    const zipPath = join(tempDir("maibuk out "), "plugin.zip");
    await packagePlugin(folder, zipPath);

    const { problems } = checkPackageLayout(zipPath, { forbiddenStrings: [] });
    expect(problems.some((problem) => problem.includes("src/extra.ts"))).toBe(true);
  });
});
