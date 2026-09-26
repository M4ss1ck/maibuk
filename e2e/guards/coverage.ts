// The E2E pre-run guard, as pure functions over file contents. run.ts feeds
// it the real repository; coverage.test.ts feeds it bad fixtures. Every
// problem carries a stable `code` so a failing run names its reason.

import { type Exclusion, GITHUB_ISSUE_URL, type MatrixRow } from "./types";

export type ProblemCode =
  | "duplicate-row"
  | "row-planned"
  | "row-no-spec"
  | "row-shortcut-untagged"
  | "not-accepted-without-issue"
  | "not-accepted-without-fail"
  | "unknown-term"
  | "unknown-shortcut"
  | "unknown-route"
  | "unknown-section"
  | "unknown-row-tag"
  | "term-uncovered"
  | "shortcut-uncovered"
  | "route-uncovered"
  | "skip-fixme-only"
  | "fail-without-issue"
  | "keyboard-contract"
  | "storage-outside-support"
  | "orphan-tag";

export interface Problem {
  code: ProblemCode;
  message: string;
}

export interface SourceFile {
  /** Repository-relative path with forward slashes, e.g. `e2e/specs/x.spec.ts`. */
  path: string;
  source: string;
}

export interface GuardInput {
  rows: MatrixRow[];
  exclusions: Exclusion[];
  contextMd: string;
  shortcutRegistrySource: string;
  appRoutesSource: string;
  /** Every `e2e/specs/**` file. */
  specs: SourceFile[];
  /** Every other `.ts`/`.mjs` file under `e2e/` (support, config, runner). */
  otherE2eFiles: SourceFile[];
  allowPlanned: boolean;
}

/** Files that may touch IndexedDB/localStorage: setup and fault helpers only. */
export const STORAGE_ALLOWED = ["e2e/support/storage.ts", "e2e/support/fault.ts"];

// ---------------------------------------------------------------------------
// Parsers

export interface ContextTerm {
  term: string;
  section: string;
}

/** `**Term**:` lines, with the `## Section` they sit under. */
export function parseContextTerms(md: string): ContextTerm[] {
  const terms: ContextTerm[] = [];
  let section = "";
  for (const line of md.split("\n")) {
    const heading = /^## (.+)$/.exec(line);
    if (heading) {
      section = heading[1].trim();
      continue;
    }
    const term = /^\*\*(.+?)\*\*:/.exec(line);
    if (term) terms.push({ term: term[1], section });
  }
  return terms;
}

export function parseContextSections(md: string): string[] {
  return [...md.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
}

/** Keys of the `SHORTCUTS` object literal in src/lib/shortcut-registry.ts. */
export function parseShortcutIds(source: string): string[] {
  const start = source.indexOf("export const SHORTCUTS = {");
  if (start === -1) throw new Error("shortcut registry: `export const SHORTCUTS = {` not found");
  const end = source.indexOf("\n} as const", start);
  if (end === -1) throw new Error("shortcut registry: closing `} as const` not found");
  const block = source.slice(start, end);
  return [...block.matchAll(/^ {2}"([\w.]+)":/gm)].map((m) => m[1]);
}

/** Absolute route patterns declared in App.tsx (`index` routes are `/`). */
export function parseAppRoutes(source: string): string[] {
  const routes = new Set<string>();
  for (const m of source.matchAll(/<Route\b([^>]*)>/g)) {
    const attrs = m[1];
    const path = /\bpath="([^"]*)"/.exec(attrs)?.[1];
    if (path !== undefined) routes.add(path.startsWith("/") ? path : `/${path}`);
    else if (/\bindex\b/.test(attrs)) routes.add("/");
  }
  return [...routes].sort();
}

/**
 * Two views of a source file: `code` has comments removed and string
 * contents blanked (for API scans, so a title saying "click" is not a
 * click); `text` has only comments removed (for tags, which live in titles).
 */
export function sourceViews(source: string): { code: string; text: string } {
  let code = "";
  let text = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      code += quote;
      text += quote;
      i++;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === "\\") {
          text += source.slice(i, i + 2);
          code += "  ";
          i += 2;
          continue;
        }
        text += source[i];
        code += source[i] === "\n" ? "\n" : " ";
        i++;
      }
      code += quote;
      text += quote;
      i++;
      continue;
    }
    code += c;
    text += c;
    i++;
  }
  return { code, text };
}

const TAG = /@(wf|sc):([\w.-]+)/g;

/** Index just past the `)` closing the call whose `(` sits at `open - 1`. */
function callEnd(code: string, open: number): number {
  let depth = 1;
  let i = open;
  while (i < code.length && depth > 0) {
    if (code[i] === "(") depth++;
    else if (code[i] === ")") depth--;
    i++;
  }
  return i;
}

/**
 * Tags that declare coverage: those in the title (first argument) of a
 * `test(...)` or `test.fail(...)` declaration, or of a `test.describe(...)`
 * whose body declares at least one test. A tag anywhere else is inert, so a
 * spec cannot claim a row with a string that runs nothing. `code` and `text`
 * are the aligned views from `sourceViews`.
 */
function declaredTags(
  code: string,
  text: string
): { wf: Set<string>; sc: Set<string>; titleRanges: [number, number][] } {
  const declarations = [
    ...code.matchAll(
      /\btest(\.describe(?:\.(?:serial|parallel))?|\.fail)?\s*\(\s*(["'`])/g
    ),
  ].map((m) => {
    const titleStart = (m.index ?? 0) + m[0].length;
    const titleEnd = code.indexOf(m[2], titleStart);
    const open = code.indexOf("(", m.index ?? 0) + 1;
    return {
      isDescribe: m[1]?.startsWith(".describe") ?? false,
      titleStart,
      titleEnd,
      end: callEnd(code, open),
      start: m.index ?? 0,
    };
  });
  const tests = declarations.filter((d) => !d.isDescribe);
  const counted = declarations.filter(
    (d) => !d.isDescribe || tests.some((t) => t.start > d.start && t.start < d.end)
  );

  const wf = new Set<string>();
  const sc = new Set<string>();
  for (const d of counted) {
    for (const m of text.slice(d.titleStart, d.titleEnd).matchAll(TAG)) {
      (m[1] === "wf" ? wf : sc).add(m[2]);
    }
  }
  return { wf, sc, titleRanges: counted.map((d) => [d.titleStart, d.titleEnd]) };
}

/** Argument text of every `test.fail(` call, up to its body. */
function failCalls(text: string): string[] {
  const calls: string[] = [];
  for (const m of text.matchAll(/\btest\.fail\s*\(/g)) {
    let depth = 1;
    let i = (m.index ?? 0) + m[0].length;
    const start = i;
    while (i < text.length && depth > 0) {
      if (text[i] === "(") depth++;
      else if (text[i] === ")") depth--;
      i++;
    }
    const args = text.slice(start, i - 1);
    // A declaration `test.fail(title, details, async () => {...})` must cite
    // the issue before its body; an in-test `test.fail(cond, "url")` anywhere.
    const body = args.search(/\basync\b|=>/);
    calls.push(body === -1 ? args : args.slice(0, body));
  }
  return calls;
}

// ---------------------------------------------------------------------------
// Keyboard contract (AC5)

const BANNED_IN_SPECS: { pattern: RegExp; why: string; view?: "text" }[] = [
  {
    pattern:
      /\.(click|dblclick|hover|tap|dragTo|check|uncheck|setChecked|selectOption|selectText|fill|clear|focus|blur|setInputFiles|pressSequentially)\s*\(/g,
    why: "pointer or programmatic interaction; drive it with page.keyboard",
  },
  {
    pattern: /(?<!keyboard)\.(press|type)\s*\(/g,
    why: "locator.press/type focuses the element for you; press keys on page.keyboard",
  },
  { pattern: /\b(mouse|touchscreen)\s*\./g, why: "pointer input" },
  { pattern: /\.dispatchEvent\s*\(/g, why: "synthetic event" },
  {
    pattern:
      /\.(evaluate|evaluateHandle|evaluateAll|addInitScript|exposeFunction|exposeBinding|\$eval|\$\$eval)\s*\(/g,
    why: "page script can reach app state; setup belongs in e2e/support/",
  },
  {
    // A type-only import cannot bypass the fixtures, so `import type` is fine.
    pattern: /\bimport\s+(?!type\b)[^;]*?from\s*["']@playwright\/test["']/g,
    why: 'import test/expect from "../support/test" so every test gets its prepared device',
    // The module name is a string, which the code view blanks.
    view: "text",
  },
  { pattern: /\bretries\s*:/g, why: "retries hide flakes; the suite runs with retries 0" },
];

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

// ---------------------------------------------------------------------------
// The check

export function checkCoverage(input: GuardInput): Problem[] {
  const problems: Problem[] = [];
  const add = (code: ProblemCode, message: string) => problems.push({ code, message });

  const contextTerms = parseContextTerms(input.contextMd);
  const termNames = new Set(contextTerms.map((t) => t.term));
  const sections = new Set(parseContextSections(input.contextMd));
  const shortcutIds = parseShortcutIds(input.shortcutRegistrySource);
  const shortcutSet = new Set(shortcutIds);
  const routes = parseAppRoutes(input.appRoutesSource);
  const routeSet = new Set(routes);

  // Specs: tags, banned calls, skips, expected failures.
  const specTags = input.specs.map((spec) => {
    const { code, text } = sourceViews(spec.source);
    for (const { pattern, why, view } of BANNED_IN_SPECS) {
      const scanned = view === "text" ? text : code;
      for (const m of scanned.matchAll(pattern)) {
        add(
          "keyboard-contract",
          `${spec.path}:${lineOf(scanned, m.index ?? 0)} uses \`${m[0].trim()}\`: ${why}`
        );
      }
    }
    for (const m of code.matchAll(
      /\b(?:test|it|describe)(?:\.describe)?(?:\.(?:serial|parallel))?\.(skip|fixme|only)\b/g
    )) {
      add(
        "skip-fixme-only",
        `${spec.path}:${lineOf(code, m.index ?? 0)} uses \`${m[0]}\`: coverage may not be skipped or focused`
      );
    }
    const fails = failCalls(text);
    for (const args of fails) {
      if (!GITHUB_ISSUE_URL.test(args)) {
        add(
          "fail-without-issue",
          `${spec.path} has test.fail() without a GitHub issue URL (https://github.com/M4ss1ck/maibuk/issues/N)`
        );
      }
    }
    const { wf, sc, titleRanges } = declaredTags(code, text);
    for (const m of text.matchAll(TAG)) {
      const at = m.index ?? 0;
      if (titleRanges.some(([from, to]) => at >= from && at < to)) continue;
      add(
        "orphan-tag",
        `${spec.path}:${lineOf(text, at)} has \`${m[0]}\` outside the title of a declared test or of a describe that declares one; it counts as no coverage`
      );
    }
    for (const id of sc) {
      if (!shortcutSet.has(id))
        add("unknown-shortcut", `${spec.path} tags @sc:${id}, not a registry id`);
    }
    return {
      path: spec.path,
      wf,
      sc,
      failIssues: fails.flatMap((f) => f.match(GITHUB_ISSUE_URL) ?? []),
    };
  });

  // Rows.
  const rowIds = new Set<string>();
  for (const row of input.rows) {
    if (rowIds.has(row.id)) add("duplicate-row", `matrix row ${row.id} appears twice`);
    rowIds.add(row.id);

    for (const term of row.terms) {
      if (!termNames.has(term))
        add("unknown-term", `row ${row.id} lists "${term}", not a CONTEXT.md term`);
    }
    for (const id of row.shortcuts) {
      if (!shortcutSet.has(id))
        add("unknown-shortcut", `row ${row.id} lists ${id}, not a registry id`);
    }
    for (const route of row.routes) {
      if (!routeSet.has(route))
        add("unknown-route", `row ${row.id} lists ${route}, not an App.tsx route`);
    }

    if (row.status === "planned") {
      if (!input.allowPlanned) {
        add(
          "row-planned",
          `row ${row.id} is planned: no spec yet (pass --allow-planned while building)`
        );
      }
      continue;
    }

    const carriers = specTags.filter((s) => s.wf.has(row.id));
    if (carriers.length === 0) {
      add("row-no-spec", `row ${row.id} is ${row.status} but no spec carries @wf:${row.id}`);
      continue;
    }
    for (const id of row.shortcuts) {
      if (!carriers.some((s) => s.sc.has(id))) {
        add(
          "row-shortcut-untagged",
          `row ${row.id} covers ${id} but no spec carrying @wf:${row.id} tags @sc:${id}`
        );
      }
    }
    if (row.status === "not-accepted") {
      if (!row.issue || !GITHUB_ISSUE_URL.test(row.issue)) {
        add(
          "not-accepted-without-issue",
          `row ${row.id} is not-accepted without a GitHub issue URL`
        );
      } else if (!carriers.some((s) => s.failIssues.includes(row.issue as string))) {
        add(
          "not-accepted-without-fail",
          `row ${row.id} is not-accepted but no spec carrying it has test.fail() citing ${row.issue}`
        );
      }
    }
  }

  for (const spec of specTags) {
    for (const id of spec.wf) {
      if (!rowIds.has(id))
        add("unknown-row-tag", `${spec.path} tags @wf:${id}, which no matrix row has`);
    }
  }

  // Exclusions.
  const excludedSections = new Set<string>();
  const excluded = {
    term: new Set<string>(),
    shortcut: new Set<string>(),
    route: new Set<string>(),
  };
  for (const exclusion of input.exclusions) {
    switch (exclusion.kind) {
      case "context-section":
        if (!sections.has(exclusion.section)) {
          add(
            "unknown-section",
            `exclusion names CONTEXT.md section "${exclusion.section}", which does not exist`
          );
        }
        excludedSections.add(exclusion.section);
        break;
      case "term":
        for (const item of exclusion.items) {
          if (!termNames.has(item))
            add("unknown-term", `exclusion lists "${item}", not a CONTEXT.md term`);
          excluded.term.add(item);
        }
        break;
      case "shortcut":
        for (const item of exclusion.items) {
          if (!shortcutSet.has(item))
            add("unknown-shortcut", `exclusion lists ${item}, not a registry id`);
          excluded.shortcut.add(item);
        }
        break;
      case "route":
        for (const item of exclusion.items) {
          if (!routeSet.has(item))
            add("unknown-route", `exclusion lists ${item}, not an App.tsx route`);
          excluded.route.add(item);
        }
        break;
      case "behavior":
        break;
    }
  }

  // Coverage: every term, shortcut, and route has a row or an exclusion.
  const rowTerms = new Set(input.rows.flatMap((r) => r.terms));
  for (const { term, section } of contextTerms) {
    if (excludedSections.has(section) || excluded.term.has(term) || rowTerms.has(term)) continue;
    add(
      "term-uncovered",
      `CONTEXT.md term "${term}" (${section}) has no matrix row and no exclusion`
    );
  }
  const rowShortcuts = new Set(input.rows.flatMap((r) => r.shortcuts));
  for (const id of shortcutIds) {
    if (excluded.shortcut.has(id) || rowShortcuts.has(id)) continue;
    add("shortcut-uncovered", `shortcut ${id} has no matrix row and no exclusion`);
  }
  const rowRoutes = new Set(input.rows.flatMap((r) => r.routes));
  for (const route of routes) {
    if (excluded.route.has(route) || rowRoutes.has(route)) continue;
    add("route-uncovered", `route ${route} has no matrix row and no exclusion`);
  }

  // Storage is setup: only the support helpers may touch it.
  for (const file of [...input.specs, ...input.otherE2eFiles]) {
    if (STORAGE_ALLOWED.includes(file.path)) continue;
    const { code } = sourceViews(file.source);
    for (const m of code.matchAll(/\b(indexedDB|localStorage|sessionStorage)\b/g)) {
      add(
        "storage-outside-support",
        `${file.path}:${lineOf(code, m.index ?? 0)} touches ${m[1]}; only ${STORAGE_ALLOWED.join(" and ")} may`
      );
    }
  }

  return problems;
}
