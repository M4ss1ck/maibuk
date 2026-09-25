// Guard self-tests (node:test, run by `pnpm test:e2e` before Playwright; not
// discoverable by Vitest). Each case feeds one bad fixture and expects the
// guard to reject it with the named reason; the baseline proves a clean
// input passes, so a guard that rejects everything fails here too.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkCoverage,
  type GuardInput,
  parseAppRoutes,
  parseShortcutIds,
  type ProblemCode,
  sourceViews,
} from "./coverage";
import type { MatrixRow } from "./types";

const CONTEXT = `# App

## Library

**Book**:
A long work.

**Gallery**:
Where Books are browsed.

## Sync

**Push**:
Upload.
`;

const REGISTRY = `import { x } from "y";
export const SHORTCUTS = {
  "home.newBook": { labelKey: "a", keys: ["Ctrl+N"] },
  "editor.save": {
    labelKey: "b",
    keys: ["Ctrl+S"],
  },
} as const;
`;

const APP = `
<Routes>
  <Route path="/" element={<Layout />}>
    <Route index element={<Home />} />
  </Route>
  <Route path="book/:bookId" element={<BookEditor />} />
</Routes>`;

const ISSUE = "https://github.com/M4ss1ck/maibuk/issues/999";

function row(overrides: Partial<MatrixRow> = {}): MatrixRow {
  return {
    id: "books-create",
    area: "books",
    workflow: "create a Book",
    edges: [],
    terms: ["Book", "Gallery"],
    shortcuts: ["home.newBook", "editor.save"],
    routes: ["/", "/book/:bookId"],
    fixture: "empty",
    tags: [],
    status: "accepted",
    ...overrides,
  };
}

const GOOD_SPEC = `import { expect, test } from "../support/test";
test.describe("books-create @wf:books-create @sc:home.newBook @sc:editor.save", () => {
  test("creates", async ({ page }) => {
    await page.keyboard.press("ControlOrMeta+n");
    await expect(page.getByRole("dialog")).toBeVisible();
  });
});
`;

function input(overrides: Partial<GuardInput> = {}): GuardInput {
  return {
    rows: [row()],
    exclusions: [
      { kind: "context-section", section: "Sync", reason: "out of scope", owner: "Vitest" },
    ],
    contextMd: CONTEXT,
    shortcutRegistrySource: REGISTRY,
    appRoutesSource: APP,
    specs: [{ path: "e2e/specs/books.spec.ts", source: GOOD_SPEC }],
    otherE2eFiles: [],
    allowPlanned: false,
    ...overrides,
  };
}

function codes(overrides: Partial<GuardInput>): ProblemCode[] {
  return checkCoverage(input(overrides)).map((p) => p.code);
}

function specWith(body: string): Partial<GuardInput> {
  return {
    specs: [
      {
        path: "e2e/specs/books.spec.ts",
        source: GOOD_SPEC.replace('await expect(page.getByRole("dialog")).toBeVisible();', body),
      },
    ],
  };
}

describe("parsers", () => {
  it("reads registry ids, including multi-line entries", () => {
    assert.deepEqual(parseShortcutIds(REGISTRY), ["home.newBook", "editor.save"]);
  });

  it("reads App.tsx routes as absolute patterns, index as /", () => {
    assert.deepEqual(parseAppRoutes(APP), ["/", "/book/:bookId"]);
  });

  it("keeps tags in strings but blanks strings and comments for API scans", () => {
    const { code, text } = sourceViews(`test("do not click( @wf:a"); // .click(\nx.y();`);
    assert.match(text, /@wf:a/);
    assert.doesNotMatch(code, /click/);
    assert.doesNotMatch(text, /\/\/ \.click/);
  });
});

describe("checkCoverage", () => {
  it("accepts a clean matrix and spec", () => {
    assert.deepEqual(checkCoverage(input()), []);
  });

  it("rejects a CONTEXT.md term with no row and no exclusion", () => {
    assert.deepEqual(codes({ rows: [row({ terms: ["Book"] })] }), ["term-uncovered"]);
  });

  it("rejects a term that is not in CONTEXT.md", () => {
    assert.ok(
      codes({ rows: [row({ terms: ["Book", "Gallery", "Bok"] })] }).includes("unknown-term")
    );
  });

  it("does not require terms of an excluded section, but rejects excluding a missing section", () => {
    assert.deepEqual(codes({}), []);
    assert.ok(
      codes({
        exclusions: [{ kind: "context-section", section: "Synk", reason: "r", owner: "o" }],
      }).includes("unknown-section")
    );
  });

  it("rejects a shortcut with no row and no exclusion", () => {
    const result = codes({ rows: [row({ shortcuts: ["home.newBook"] })] });
    assert.deepEqual(result, ["shortcut-uncovered"]);
  });

  it("accepts an excluded shortcut", () => {
    assert.deepEqual(
      codes({
        rows: [row({ shortcuts: ["home.newBook"] })],
        exclusions: [
          { kind: "context-section", section: "Sync", reason: "r", owner: "o" },
          { kind: "shortcut", items: ["editor.save"], reason: "r", owner: "o" },
        ],
      }),
      []
    );
  });

  it("rejects a row shortcut no spec carrying the row tags with @sc:", () => {
    const spec = GOOD_SPEC.replace(" @sc:editor.save", "");
    assert.deepEqual(codes({ specs: [{ path: "e2e/specs/books.spec.ts", source: spec }] }), [
      "row-shortcut-untagged",
    ]);
  });

  it("rejects an @sc: tag that is not a registry id", () => {
    const spec = GOOD_SPEC.replace("@sc:editor.save", "@sc:editor.save @sc:editor.sav");
    assert.ok(
      codes({ specs: [{ path: "e2e/specs/b.spec.ts", source: spec }] }).includes("unknown-shortcut")
    );
  });

  it("rejects an app route with no row", () => {
    assert.deepEqual(codes({ rows: [row({ routes: ["/"] })] }), ["route-uncovered"]);
  });

  it("rejects a row route that App.tsx does not declare", () => {
    assert.ok(
      codes({ rows: [row({ routes: ["/", "/book/:bookId", "/books"] })] }).includes("unknown-route")
    );
  });

  it("rejects an accepted row whose @wf: tag no spec carries", () => {
    const spec = GOOD_SPEC.replace("@wf:books-create", "@wf:other");
    const result = codes({ specs: [{ path: "e2e/specs/b.spec.ts", source: spec }] });
    assert.ok(result.includes("row-no-spec"));
    assert.ok(result.includes("unknown-row-tag"));
  });

  it("does not count a tag that only appears in a comment", () => {
    const spec = `// @wf:books-create @sc:home.newBook @sc:editor.save\n${GOOD_SPEC.replace(
      "books-create @wf:books-create @sc:home.newBook @sc:editor.save",
      "books-create"
    )}`;
    assert.ok(
      codes({ specs: [{ path: "e2e/specs/b.spec.ts", source: spec }] }).includes("row-no-spec")
    );
  });

  it("rejects planned rows unless --allow-planned", () => {
    const planned = { rows: [row({ status: "planned" })], specs: [] };
    assert.deepEqual(codes(planned), ["row-planned"]);
    assert.deepEqual(codes({ ...planned, allowPlanned: true }), []);
  });

  it("rejects duplicate row ids", () => {
    assert.ok(codes({ rows: [row(), row()] }).includes("duplicate-row"));
  });

  for (const [label, body] of [
    ["test.skip", 'test.skip("x", async () => {});'],
    ["test.fixme", 'test.fixme("x", async () => {});'],
    ["test.only", 'test.only("x", async () => {});'],
    ["test.describe.only", 'test.describe.only("x", () => {});'],
    ["test.describe.skip", 'test.describe.skip("x", () => {});'],
    ["conditional test.skip", 'test.skip(browserName === "webkit", "nope");'],
  ] as const) {
    it(`rejects ${label}`, () => {
      assert.deepEqual(codes(specWith(body)), ["skip-fixme-only"]);
    });
  }

  it("rejects test.fail() without a GitHub issue URL", () => {
    assert.deepEqual(codes(specWith('test.fail(true, "broken");')), ["fail-without-issue"]);
  });

  it("accepts test.fail() citing an issue", () => {
    assert.deepEqual(codes(specWith(`test.fail(true, "${ISSUE}: undecided");`)), []);
  });

  it("rejects a test.fail() declaration whose issue only appears in its body", () => {
    const body = `test.fail("gap", async ({ page }) => { await page.goto("${ISSUE}"); });`;
    assert.deepEqual(codes(specWith(body)), ["fail-without-issue"]);
  });

  it("rejects a not-accepted row without an issue, or whose spec has no matching test.fail", () => {
    assert.ok(
      codes({ rows: [row({ status: "not-accepted" })] }).includes("not-accepted-without-issue")
    );
    assert.ok(
      codes({ rows: [row({ status: "not-accepted", issue: ISSUE })] }).includes(
        "not-accepted-without-fail"
      )
    );
    assert.deepEqual(
      codes({
        rows: [row({ status: "not-accepted", issue: ISSUE })],
        ...specWith(`test.fail(true, "${ISSUE}");`),
      }),
      []
    );
  });

  for (const call of [
    'await page.getByRole("button").click();',
    'await page.getByRole("button").dblclick();',
    'await page.getByRole("button").hover();',
    'await page.getByRole("textbox").fill("x");',
    'await page.getByRole("textbox").focus();',
    'await page.getByRole("textbox").press("Enter");',
    'await page.getByRole("textbox").type("x");',
    'await page.getByRole("checkbox").check();',
    'await page.getByRole("combobox").selectOption("a");',
    'await page.locator("input").setInputFiles("a.txt");',
    "await page.mouse.click(1, 2);",
    "await page.touchscreen.tap(1, 2);",
    'await page.getByRole("button").dispatchEvent("click");',
    "await page.evaluate(() => 1);",
    'await page.$eval("x", (e) => e);',
    "await page.addInitScript(() => {});",
  ]) {
    it(`rejects \`${call}\` in a spec`, () => {
      const result = codes(specWith(call));
      assert.ok(result.length > 0);
      assert.ok(
        result.every((code) => code === "keyboard-contract"),
        result.join()
      );
    });
  }

  it("allows keyboard presses and file choosers opened by keys", () => {
    const body = `await page.keyboard.press("Tab");
    await page.keyboard.type("hello");
    const chooser = page.waitForEvent("filechooser");
    await page.keyboard.press("Enter");
    await (await chooser).setFiles("a.epub");`;
    assert.deepEqual(codes(specWith(body)), []);
  });

  it("rejects importing @playwright/test directly in a spec", () => {
    const spec = GOOD_SPEC.replace('"../support/test"', '"@playwright/test"');
    assert.deepEqual(codes({ specs: [{ path: "e2e/specs/b.spec.ts", source: spec }] }), [
      "keyboard-contract",
    ]);
  });

  it("rejects retries in a spec", () => {
    assert.deepEqual(codes(specWith("test.describe.configure({ retries: 2 });")), [
      "keyboard-contract",
    ]);
  });

  it("rejects storage access outside the support helpers", () => {
    assert.deepEqual(codes(specWith("const x = localStorage;")), ["storage-outside-support"]);
    assert.deepEqual(
      codes({
        otherE2eFiles: [{ path: "e2e/support/keyboard.ts", source: "indexedDB.open('x');" }],
      }),
      ["storage-outside-support"]
    );
    assert.deepEqual(
      codes({
        otherE2eFiles: [{ path: "e2e/support/storage.ts", source: "indexedDB.open('x');" }],
      }),
      []
    );
  });
});
