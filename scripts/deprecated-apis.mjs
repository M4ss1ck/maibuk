#!/usr/bin/env node
// The deprecation gate (issue #670): fails when code in src/, plugins/,
// scripts/, or e2e/ uses a symbol a dependency or the DOM lib marks
// `@deprecated`. TypeScript reports those uses as suggestion diagnostics
// 6385-6387 with `reportsDeprecated`; `tsc` never prints suggestions, so this
// asks the compiler through its API. It takes seconds, so it runs in CI's
// `checks` job, not in `pnpm test:guards`.
//
//   pnpm check:deprecated
//
// A use with no documented alternative stays only with a reason on the line
// directly above it:
//
//   // deprecated-api: <why nothing else does this>
//
// A marker with no reason, or with nothing deprecated on the next line, fails.

import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Every project the gate opens; together they cover the four gated roots. */
const PROJECTS = ["tsconfig.json", "e2e/tsconfig.json", "scripts/tsconfig.deprecations.json"];

const GATED_ROOTS = ["src/", "plugins/", "scripts/", "e2e/"];

const MARKER = /^(\s*)\/\/\s*deprecated-api:(.*)$/;

/** Whether a repo-relative path is code this repo owns under a gated root. */
export function isGatedFile(file) {
  const path = file.split("\\").join("/");
  if (!GATED_ROOTS.some((root) => path.startsWith(root))) return false;
  return !path.split("/").some((part) => part === "node_modules" || part === "vendor");
}

function lineStarts(source) {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === "\n") starts.push(i + 1);
  return starts;
}

/** 1-based line and column of an offset. */
function position(starts, pos) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: pos - starts[lo] + 1 };
}

/**
 * The gate's findings, one `file:line:column message` string each, sorted:
 * deprecated uses without a marker, markers without a reason, and markers
 * that cover nothing.
 *
 * @param {{ root: string, files: string[], diagnostics: { fileName?: string, pos: number, text: string, reportsDeprecated?: boolean }[], readSource: (path: string) => string }} input
 */
export function deprecationProblems({ root, files, diagnostics, readSource }) {
  const problems = [];
  const sources = new Map();
  const read = (path) => {
    if (!sources.has(path)) {
      const text = readSource(path);
      sources.set(path, { lines: text.split("\n"), starts: lineStarts(text) });
    }
    return sources.get(path);
  };

  /** `${file}:${line}` of each marker that covers a use. */
  const usedMarkers = new Set();
  const seen = new Set();
  for (const diagnostic of diagnostics) {
    if (!diagnostic.reportsDeprecated || !diagnostic.fileName) continue;
    const file = relative(root, diagnostic.fileName).split("\\").join("/");
    if (!isGatedFile(file)) continue;
    const { lines, starts } = read(diagnostic.fileName);
    const { line, column } = position(starts, diagnostic.pos);
    const key = `${file}:${line}:${column} ${diagnostic.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const marker = MARKER.exec(lines[line - 2] ?? "");
    if (marker && marker[2].trim() !== "") {
      usedMarkers.add(`${file}:${line - 1}`);
      continue;
    }
    problems.push({ file, line, column, message: diagnostic.text });
  }

  for (const path of files) {
    const file = relative(root, path).split("\\").join("/");
    if (!isGatedFile(file)) continue;
    read(path).lines.forEach((text, index) => {
      const marker = MARKER.exec(text);
      if (!marker) return;
      const line = index + 1;
      const column = marker[1].length + 1;
      if (marker[2].trim() === "") {
        problems.push({ file, line, column, message: "deprecated-api marker needs a reason" });
      } else if (!usedMarkers.has(`${file}:${line}`)) {
        problems.push({
          file,
          line,
          column,
          message: "unused deprecated-api marker (nothing deprecated on the next line)",
        });
      }
    });
  }

  return problems
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column)
    .map(({ file, line, column, message }) => `${file}:${line}:${column} ${message}`);
}

async function main() {
  const root = resolve(fileURLToPath(import.meta.url), "../..");
  // The compiler API ships with TypeScript 7 as `unstable`; it is pinned with
  // the compiler in package.json, so a bump that moves it fails here first.
  const { API } = await import("typescript/unstable/sync");
  const api = new API({ cwd: root });
  const diagnostics = [];
  const files = new Set();
  try {
    const snapshot = api.updateSnapshot({
      openProjects: PROJECTS.map((project) => resolve(root, project)),
    });
    for (const project of snapshot.getProjects()) {
      const program = project.program;
      for (const file of program.getSourceFileNames()) files.add(file);
      diagnostics.push(...program.getSuggestionDiagnostics());
    }
  } finally {
    api.close();
  }
  const problems = deprecationProblems({
    root,
    files: [...files],
    diagnostics,
    readSource: (path) => readFileSync(path, "utf8"),
  });
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) {
    console.error(
      `\n[deprecated] ${problems.length} finding(s). Migrate to the alternative the @deprecated tag names; ` +
        "if there is none, add `// deprecated-api: <reason>` on the line above (CODING_STANDARDS.md)."
    );
    process.exit(1);
  }
  console.log(`[deprecated] ${files.size} files across ${PROJECTS.length} projects, no deprecated APIs`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
