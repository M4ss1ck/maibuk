// Shapes of the coverage matrix (e2e/coverage-matrix.ts). Kept apart from the
// data so the guard's self-tests can build small matrices of their own.

export type Area =
  | "shell"
  | "books"
  | "chapters"
  | "editor"
  | "side-panel"
  | "notes"
  | "ephemeral"
  | "canvas"
  | "cover"
  | "history"
  | "library-data"
  | "settings"
  | "metrics"
  | "tutorial"
  | "embed";

/**
 * - `planned`: no spec yet. Fails the run unless `--allow-planned` is passed.
 * - `accepted`: every listed edge has its own passing test.
 * - `not-accepted`: an undecided-interaction gap; its spec keeps the test as
 *   `test.fail()` citing `issue`.
 */
export type RowStatus = "planned" | "accepted" | "not-accepted";

export type RowTag =
  | "chromium-only"
  | "mac-platform"
  | "clock"
  | "download"
  | "filechooser"
  | "fault"
  | "simulated";

export interface MatrixRow {
  /** Becomes the `@wf:<id>` tag specs carry. */
  id: string;
  area: Area;
  /** What the author does, and the keys the test drives. */
  workflow: string;
  /** Edge paths; each one gets its own test. */
  edges: string[];
  /** CONTEXT.md terms this row exercises. */
  terms: string[];
  /** Shortcut registry ids; each must be tagged `@sc:<id>` in a spec carrying this row. */
  shortcuts: string[];
  /** App routes (as written in App.tsx, e.g. `/book/:bookId`) the row drives. */
  routes: string[];
  /** Seed Library the row starts from. */
  fixture: string;
  tags: RowTag[];
  status: RowStatus;
  /** Required for `not-accepted`: the GitHub issue that decides the interaction. */
  issue?: string;
}

interface ExclusionBase {
  reason: string;
  /** Who covers it instead: a Vitest suite, manual QA, or a follow-up issue. */
  owner: string;
}

export type Exclusion = ExclusionBase &
  (
    | { kind: "context-section"; section: string }
    | { kind: "term"; items: string[] }
    | { kind: "shortcut"; items: string[] }
    | { kind: "route"; items: string[] }
    /** Behavior with no term, shortcut, or route of its own (touch, OAuth2...). */
    | { kind: "behavior"; items: string[] }
  );

export const GITHUB_ISSUE_URL = /https:\/\/github\.com\/M4ss1ck\/maibuk\/issues\/\d+/;
