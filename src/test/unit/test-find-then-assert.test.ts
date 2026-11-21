import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// `expect(await screen.findByText("Saved")).toBeInTheDocument()` reads as a
// stronger check than the `await` alone and is strictly weaker: a resolved
// `findBy*` already proves the node is there. The wrapper only adds a window
// between the find and the presence check, and a re-render in that window
// detaches the found node, so `toBeInTheDocument` fails at random on CI while
// the feature under test is fine (#893, plugins/maibuk-mcp/connect-page.test.tsx).
// Write `await screen.findBy*(...)` alone; it is the assertion. See
// CODING_STANDARDS.md "An assertion after an action must fail if the action
// did nothing".

const root = resolve(__dirname, "../../..");

/** `expect(` then `await` then whatever the find query is scoped to. */
const AWAIT_IN_EXPECT = /expect\(\s*await\s+/g;

/** A find call at the start of the text it is run on. */
const FIND_CALL = /^findBy\w+\(/;

/** The index of the quote that closes the string opening at `start`. */
function stringEnd(text: string, start: number): number {
  const quote = text[start];
  for (let i = start + 1; i < text.length; i += 1) {
    if (text[i] === "\\") {
      i += 1;
      continue;
    }
    if (text[i] === quote) return i;
  }
  return text.length - 1;
}

/** The index of the `)` that closes the `(` at `open`, honouring nesting. */
function callEnd(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const char = text[i];
    if (char === "\\") {
      i += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      i = stringEnd(text, i);
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** The index of the `(` opening the find call that starts at `from`, or -1. */
function findCallOpen(text: string, from: number): number {
  let at = from;
  while (at < text.length) {
    // `within(...)` scopes the query; its own arguments may nest
    // (`within(article(dialog, "0.15.2"))`), so scan them, not a `[^)]*`.
    if (text.startsWith("within(", at)) {
      const close = callEnd(text, at + "within(".length - 1);
      if (close < 0 || text[close + 1] !== ".") return -1;
      at = close + 2;
      continue;
    }
    const call = FIND_CALL.exec(text.slice(at, at + 64));
    if (call) return at + call[0].length - 1;
    // An identifier path (`screen.`, `view.`, or nothing) before the call.
    const char = text[at];
    if (char === undefined || !/[\w.]/.test(char)) return -1;
    at += 1;
  }
  return -1;
}

/** The 1-based lines where a resolved find sits inside a presence assertion. */
function findThenAssertLines(text: string): number[] {
  const lines: number[] = [];
  AWAIT_IN_EXPECT.lastIndex = 0;
  let match = AWAIT_IN_EXPECT.exec(text);
  while (match !== null) {
    const open = findCallOpen(text, match.index + match[0].length);
    const end = open < 0 ? -1 : callEnd(text, open);
    if (end > 0 && /^\s*\)\s*\.toBeInTheDocument\(/.test(text.slice(end + 1))) {
      lines.push(text.slice(0, match.index).split("\n").length);
    }
    match = AWAIT_IN_EXPECT.exec(text);
  }
  AWAIT_IN_EXPECT.lastIndex = 0;
  return lines;
}

function sourceFiles(dir: string, keep: (name: string) => boolean): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === "dist") return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path, keep);
    return keep(entry.name) ? [path] : [];
  });
}

/** Every test file, plus the shared test support a test calls into. */
function scannedFiles(): string[] {
  const isTest = (name: string) => /\.test\.tsx?$/.test(name);
  const isSource = (name: string) => /\.tsx?$/.test(name);
  return [
    ...sourceFiles(join(root, "src/test"), isTest),
    ...sourceFiles(join(root, "src/test/support"), (name) => isSource(name) && !isTest(name)),
    ...sourceFiles(join(root, "plugins"), isTest),
    ...sourceFiles(join(root, "templates"), isTest),
  ];
}

describe("find-then-assert", () => {
  it("never wraps a resolved find in a presence assertion", () => {
    const hits: string[] = [];
    for (const path of scannedFiles()) {
      // This file holds the samples the detector is tested on.
      if (path === __filename) continue;
      const file = relative(root, path).split("\\").join("/");
      for (const line of findThenAssertLines(readFileSync(path, "utf8"))) {
        hits.push(`${file}:${line}`);
      }
    }
    expect(
      hits,
      "Drop the wrapper: a resolved findBy* already proves presence, and the extra toBeInTheDocument fails when a re-render detaches the node in between (#893). Write `await screen.findBy*(...)` alone. See src/test/unit/test-find-then-assert.test.ts."
    ).toEqual([]);
  });

  it("recognizes each form", () => {
    for (const sample of [
      'expect(await screen.findByText("Saved")).toBeInTheDocument();',
      'expect(await within(row).findByRole("cell", { name: "x" })).toBeInTheDocument();',
      'expect(await within(article(dialog, "0.15.2")).findByText("x")).toBeInTheDocument();',
      'expect(await view.findByLabelText("Title")).toBeInTheDocument();',
      'expect(\n  await screen.findByRole("button", { name: "x" })\n).toBeInTheDocument();',
      'expect(\n  await screen.findByRole("button", { name: t("a(b)") })\n).toBeInTheDocument();',
      "expect(await screen.findByText(/x\\(y\\)/)).toBeInTheDocument();",
      'expect(await screen.findByText("(")).toBeInTheDocument();',
    ]) {
      expect(findThenAssertLines(sample), sample).toEqual([1]);
    }

    for (const sample of [
      'await screen.findByText("x");',
      'expect(await screen.findByRole("x")).toHaveFocus();',
      'expect(screen.getByText("x")).toBeInTheDocument();',
      'expect(await screen.findByText("x")).not.toBeInTheDocument();',
    ]) {
      expect(findThenAssertLines(sample), sample).toEqual([]);
    }

    expect(
      findThenAssertLines(
        'expect(await screen.findByText("a")).toBeInTheDocument();\nconst page = render();\nexpect(\n  await within(page).findByRole("cell")\n).toBeInTheDocument();'
      )
    ).toEqual([1, 3]);
  });
});
