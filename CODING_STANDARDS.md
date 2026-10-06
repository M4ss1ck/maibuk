# Coding Standards

The rules code in this repo is written and reviewed against. `/code-review` reads this file; an implementer reads the section a task touches (AGENTS.md says which, and when). Two more documents are standards sources and are reviewed the same way:

- `docs/agents/utilities-and-components.md`: component and store patterns, and the shared utilities to reuse instead of rewriting.
- `docs/agents/design.md`: design context and the styling rules.

## Domain language

Before naming anything or proposing a restructure, read:

1. **`GLOSSARY.md`**: the domain glossary. New identifiers, UI copy, test names, commit messages, and docs use its terms (Book, Checkpoint, Unfiled Note, Deleted Elsewhere...). A word listed under a term's _Avoid_ is a review flag.
   - Terms in the main sections describe how the app works today.
   - Terms under **Decided, not built** have an accepted ADR the code has not caught up with. Until a change implements that ADR, new code uses the current mechanism (for example, Canvases do not sync until a Canvas adapter for Entity Sync ships). Use an ADR term only for something that already behaves as the term defines; otherwise refer to the current mechanism by its code name (`refreshBooks`) and do not coin a synonym. Implementing an ADR is its own change.
   - Terms under **Anticipated** are reserved names for features nobody has decided to build. Use them if that feature is built instead of inventing a synonym.
   - A `_UI_` label marked _(known mismatch)_ is shipped copy that contradicts the glossary. It may be fixed in a dedicated copy change or in any change that already touches that screen; neither is required. The fix updates both locale files and, in the same commit, edits only the mismatched part of that `_UI_` line in `GLOSSARY.md`: the new label replaces the old one and the _(known mismatch)_ marker goes. Correct labels on the same line stay. A label that only becomes wrong once a **Decided, not built** term ships is changed by the change implementing that ADR, not before.
2. **`docs/adr/`**: architecture decisions. `status: accepted (not implemented)` means decided but not yet in the code. Do not re-propose an alternative an ADR rejected unless you can name what changed; if you do, write a new ADR that supersedes it.

An existing identifier that uses an avoided word may be renamed by a change that already touches it; that change is not required to rename it, and no change renames identifiers in a sweep. A user-visible rename changes the string in both `en.json` and `es.json` in the same commit.

When a new domain concept appears, add it to `GLOSSARY.md` in the same change: one or two sentences saying what it is, no implementation details. Record a decision as an ADR only when it is hard to reverse, would surprise a future reader, and came from a real trade-off.

## Keyboard and accessibility

These are completion requirements: interactive UI that misses one is not done.

Every new or modified UI feature ships keyboard-operable and screen-reader-correct, or it is **not done** — same standing as tests passing. Definition of done for any interactive UI:

1. **Fully operable by keyboard alone** — every action reachable without a mouse. Pointer-only interactions (drag-and-drop, hover-only controls, canvas gestures) need a keyboard path or an explicit, documented exemption in the PR.
2. **Focus is managed** — visible focus, dialogs trap and restore focus to their trigger, arrow-key navigation inside lists/menus/toolbars, Escape closes or exits.
3. **Library behavior, never hand-rolled focus code** — React Aria is the approved standard for dialogs, collections, roving focus, and keyboard-operable drag-and-drop. Do not hand-write roving tabindex, focus traps, or listbox key handling.
4. **Labels are localized** — every `aria-label` goes through i18n like any other user-visible string.
5. **Shortcuts are registered, not inlined**: every action is a Command in `src/lib/shortcut-registry.ts` (`COMMANDS`: `contexts`, `defaults` (may be `[]`), `fixed`, `sealed`) and binds by id only: `useShortcuts([{ id, onTrigger }])` takes no keys, which come from the registry merged with the author's Custom Shortcuts (ADR 0012). The id is what makes it a Bound Shortcut under "On this screen" in the help. Item Menu actions carry `commandId` and the item calls `useItemCommands`; a menu entry or toolbar button without a Command carries `data-command-exempt="<reason>"` (`command-coverage.test.ts`). A key handled elsewhere (a component's own `onKeyDown`, a native control) declares its id with `useBoundShortcutIds`; TipTap formatting keys are `source: "editor-keymap"`, and `ShortcutOverrides` runs their Custom Shortcuts through `EDITOR_COMMANDS`. A new screen lists its Shortcut Contexts in `ROUTE_CONTEXTS`. `shortcut-bindings.test.ts` fails when a registry id is bound nowhere, `shortcut-registry.test.ts` when Default Shortcuts conflict or a route has no Contexts.
6. **Proven by behavioral tests** — see "Keyboard and accessibility test gate" under Testing.
7. **Reachable by touch** — Android and phone browsers have no hover, and Tailwind 4 only applies `hover:`/`group-hover:` where hover exists. Mouse devices keep their hover-revealed one-click actions; the same element gets `pointer-coarse:hidden`, and touch screens get the actions another way: an item's actions go in a ⋯ `ItemActionsMenu` shown with `hidden pointer-coarse:inline-flex` (or an `ItemActionsPopover` for Canvas nodes), opened also by long-press through `useItemContextMenu`; a single action becomes a visible control on coarse pointers. `src/test/unit/touch-reachability.test.ts` fails on a hover reveal with no `pointer-coarse:` class unless it is listed there with its touch path. Long-press opens the Item Menu, so on touch a drag starts only from a `data-drag-handle` (wrap the list in `useTouchDragFromHandle`); a React Aria drag button goes through `ReorderHandle`, because React Aria makes the button itself ignore pointers. Remember where phones actually browse: on a phone the Notes gallery, not the notes list, is how notes are reached. The `phone` E2E project (`@touch` specs) proves these paths with real touch input; a new touch path gets a row there too.
8. **Covered in the E2E suite**: new interactive UI is not done until it has a row in `e2e/coverage-matrix.ts` and a spec tagged `@wf:<row-id>`. See "Definition of done" under "E2E" in Testing.
9. **Shown in the PR**: a change to anything the app renders (a component's markup or classes, `src/index.css`, a token) ships before and after screenshots, light and dark, attached to the PR. Add a narrow viewport when the layout responds to width. Put a `capture(page, name)` point in the spec that reaches the state, run `pnpm screenshots -g "<test>"`, and attach with `gh pr create --attach`; see "Screenshots for a PR" in `e2e/README.md`. Look at every image before attaching it: #229 shipped a misaligned hue thumb and a cropped toolbar trigger that no assertion covered and one glance would have caught.

Why this is a hard gate: this codebase has shipped UI whose ARIA attributes and `tabIndex` wiring looked correct while the widget was inoperable by keyboard, and attribute-level tests stayed green. Attributes are not accessibility; behavior is.

## Code conventions

### Single source of truth

- App constants live in `src/constants.ts`
- Type definitions live in `src/features/<feature>/types.ts`
- Design tokens live in `src/index.css` under `@theme`
- Translation strings live in `src/locales/en.json` and `src/locales/es.json`
- Database schema lives in `src/lib/db/schema.ts`
- **Never** hardcode values that belong in these canonical locations

### Naming

- **Components**: PascalCase files and exports — `BookCard.tsx`, `export function BookCard`
- **Hooks**: camelCase with `use` prefix — `useAutoSave.ts`, `export function useAutoSave`
- **Stores**: `store.ts` inside feature folder, export as `use<Feature>Store` — `useBookStore`, `useChapterStore`
- **Types**: `types.ts` inside feature folder, interfaces are PascalCase — `Book`, `CreateBookInput`, `UpdateBookInput`
- **Feature index**: `index.ts` barrel file re-exports public API from the feature
- **Constants**: UPPER_SNAKE_CASE — `APP_VERSION`, `DOWNLOAD_PAGE`
- **CSS variables**: `--color-<name>`, `--font-<name>`, `--spacing-<name>`

### Imports

Imports follow this order (observed from existing code):

1. React / React DOM
2. Third-party libraries (`zustand`, `react-router-dom`, `@tiptap/*`, `react-aria-components`, `lucide-react`)
3. Internal imports via `@/` alias (`@/features/books`, `@/lib/db`, `@/hooks/useAutoSave`)
4. CSS imports (only in `main.tsx`)

The `@/` path alias maps to `src/` and is configured in both `tsconfig.json` (paths) and `vite.config.ts` (resolve.alias). All internal imports must use `@/` — never relative paths.

### Do not

- **Import Tauri APIs directly** — always go through `src/lib/platform/` adapters so the web build works
- **Create new Zustand stores** for data that belongs in an existing store — check `books`, `chapters`, `settings`, `theme` stores first
- **Skip barrel exports** — every feature module needs an `index.ts` that re-exports its public API

### Comments

- Focus on **why**, not **what** — the code should be self-explanatory
- Match existing style: the codebase has minimal comments, only where logic isn't obvious
- Do not add JSDoc/docstrings unless the function is a public API with non-obvious parameters

### i18n

Every user-visible string must use `useTranslation()` and have keys in both `src/locales/en.json` and `src/locales/es.json`. Do not hardcode UI text.

### Type safety

- `strict: true` in `tsconfig.json`
- All feature types defined in `types.ts` files
- Database rows typed as `Record<string, unknown>` with manual mapping via `toModel()` functions
- Platform adapters have explicit interface contracts in `src/lib/platform/types.ts`

### Linting and formatting

There is no ESLint or Prettier. Two gates run in CI's fast `checks` job: `pnpm typecheck` (TypeScript strict mode, `tsconfig.json`) and `pnpm lint` (Biome, `biome.json`), which fails the build on any error, scripts included. Vitest strips types without checking them, so a type error in a test file passes `pnpm test:run` and fails only `pnpm typecheck`. Run both before pushing.

CI runs the Vitest suite in three shards (`--shard`, `--reporter=blob`) with the coverage thresholds off, then a `coverage` job merges the blobs (`vitest run --mergeReports --coverage`) and enforces `coverage.thresholds` on the whole. `src/test/unit/ci-workflow.test.ts` fails if that layout changes.

## Area rules

### Synced entity writes

Book, Chapter, Note, and Canvas mutations go through `src/features/books/write.ts`, `src/features/chapters/write.ts`, `src/features/notes/write.ts`, and `src/features/canvas/write.ts`. These paths own normalization, persistence, stored return values, and the Change Feed. Stores remain in-memory views. Restore, Import, and the sync serializer use the same paths.

A Chapter Change identifies its containing Book. Every local Change schedules Auto Sync, including metadata. Last Edited advances for content and title changes; pin, order, and status leave it unchanged. Publish only after persistence; tests must cover failed writes, partial multi-write failures, origin, and the resulting view refresh.

### The Tutorial Library switch (ADR 0008)

While the Tutorial runs, `getDatabase()` returns an in-memory Tutorial Library (`src/features/tutorial/library-switch.ts`). The author's own database is `getAuthorDatabase()`. Rules for every change:

- **Every background job that touches the Library checks `isTutorialLibraryActive()` and does nothing while it is on**, with a test proving it. Today: Auto Sync (launch and idle), the sync store and sync engine, daily/background Backups and `BackupService.createBackup`, idle and close Checkpoints, `metricsService` (record, mark active, flush), Reading Position saves, Dictation Model downloads (`createModelStore` takes the check as `isTutorialActive`), and last-location tracking (`setLastPath`/`setLastNoteId` check `isTutorialRunInProgress()`). A new job joins this list in the same change.
- **Fire-and-forget work against the author's Library** (like the Book Editor's close Checkpoint) is wrapped in `trackAuthorLibraryWork()`, so a switch waits for it.
- **A store that caches Library rows** is listed in `LIBRARY_VIEWS` (`src/features/tutorial/tutorial-library.ts`) with how it empties and re-reads on a switch.
- **Sample ids start with `tutorial-`**. Every per-entity write path calls `assertWritableId()` on ids it did not generate; a new write path does the same.
- Sample content is built through the real write paths (`sample-library.ts`) from `tutorial.sample.*` strings in both locales.

### Tutorial steps and anchors

Steps live in `src/features/tutorial/sections.ts`. A step points at the element carrying `data-tutorial="<section>.<step>"`; never at a label or class. The attribute is a space-separated list (`tutorialTargetSelector` matches with `~=`), so one element can anchor several steps, and a fallback that replaces several controls (the unsupported message in Settings → Dictation) carries all their ids. Steps never open dialogs; a step about a dialog's contents points at the control that opens it. A step picture that must follow theme and locale is an `illustration` drawn in `TutorialIllustration` from tokens and i18n, not an `image`. When a control a step points at is renamed, moved, or removed, move its `data-tutorial` attribute with it: `tutorial-app.test.tsx` renders every step on its screen and fails when a target is missing. A new glossary term in `GLOSSARY.md` is either added to a step's `terms` or listed in `TUTORIAL_OUT_OF_SCOPE_TERMS` with a reason (`gates.test.ts`). While a run is active the app is `inert` and only the `tutorial.skip` shortcut works.

## Known footguns

- **The Library pool is app-owned** (ADR 0017, #196): the desktop/Android Library pool is built in `src-tauri/src/library_db.rs` and injected into tauri-plugin-sql; never re-add the sql `preload`, `sql:default`, `sql:allow-load` or `sql:allow-close` (`tauri-capabilities.test.ts` fails if you do), and open the Library with `Database.get`, never `Database.load`.
- **Sync write failures**: `client.ts` adds object kind/key, create/update operation, HTTP status, and validation codes to rejected writes; preserve the original status/data for duplicate detection. Test the failure through `useSyncStore` and assert an error log entry after the safety backup, not only `syncError`. A generic "Failed to create record" does not establish a duplicate: capture the validation codes before changing retry or overwrite behavior. Never log note content, auth tokens, or raw validation data.
- **Soft-deleted remote rows**: `listObjects` hides `deleted = true` rows, but they keep the unique `(user, app_name, kind, key)` identity. A local book/note with no live remote row must be checked against `listRemoteDeletedBooks()`/`listRemoteDeletedNotes()` before it is treated as local-only; creating it returns `validation_not_unique`. `resolveRemoteDeletion()` in `entity-sync.ts` owns the rules: unedited since the base → deletion review (`deletedRemotely: true`), edited → conflict with `remoteDeleted: true` (push updates the deleted row, pull removes locally). Local removal goes through `removeLocalBook()`/`removeLocalNote()` in `serializer.ts`, which record no tombstone and delete dependent rows explicitly because the web and sql.js Libraries leave SQLite's `foreign_keys` pragma off.
- **Backup dump coverage**: A Backup is whatever `SQL_EXPORT_TABLES` (`src/lib/db/sql-export-format.ts`) lists; restore (`replaceRestoreData` in `backup-service.ts`) deletes its own table list. A table restore deletes but the dump omits is wiped on every restore: Canvases were, from v0.4.14 through v0.7.1. When a table joins the dump, gate its delete on that table's section header (see `CANVASES_SECTION_TITLE`) so older Backups keep the device's rows. Test through `src/test/integration/backup-restore-canvases.test.ts`, which uses the real exporter; `createTestDatabase().exportData()` now calls `exportSqlDump` too, so never hand-write a dump in test helpers.
- **Editor latency**: Keep toolbar props stable across parent statistics updates. Toolbar controls subscribe to their own editor state; history availability should update history controls only. Share formatting snapshots through `getEditorToolbarState()` because visible and measurement groups mount separately. Build command helpers inside effects/selectors, not effect dependency arrays. Nothing whose cost grows with chapter length may run per keystroke: `Editor.tsx` coalesces `getHTML()` and word counting into one job per typing burst (`EMIT_COALESCE_MS`), so read the live document through the editor instance at save/export time rather than trusting a pushed snapshot. Verify changes with `EditorToolbarSubscriptions.test.tsx`, `editor-toolbar-state.test.ts`, `Editor.test.tsx`, and Android input measurements.
- **Filesystem scope grants**: the fs scope is the desktop webview's only write boundary. A Rust command must never widen it from a path the webview sends without native UI the author answers (folder picker or a confirmation worded in Rust); see ADR 0010 and `src-tauri/src/backup.rs`. Do not add `tauri-plugin-persisted-scope`: it keeps every picked file in scope forever
- **Platform branching**: `IS_WEB` and `IS_TAURI` are build-time constants. Test both targets when touching platform code
- **Dictation runtime**: the npm `@moonshine-ai/moonshine-wasm` is stale; `pnpm fetch:dictation` vendors the pinned release. Moonshine Spanish models add no punctuation or capitals (`capabilities` in the catalog). Latency needs `transcription_interval=0.2` and the JS stream's own `updateInterval=0.2`; native needs `MOONSHINE_ORT_SINGLE_THREAD=1` or ONNX Runtime spins several cores. `libmoonshine.so` returns a null `lines` pointer with no lines. Linux builds need `libasound2-dev`.
- **Foreign keys differ by platform**: sqlx turns `foreign_keys` on for every desktop connection, so `ON DELETE CASCADE` runs on desktop and not on the web. Never write `INSERT OR REPLACE` into `books` or `chapters`: REPLACE deletes the row first, and on desktop that cascades to the Book's Chapters, Checkpoints, assets, and EPUB structure (before this was fixed, every sync pull on desktop deleted the pulled Book's Checkpoints). Upsert with `ON CONFLICT(id) DO UPDATE`; Import does it through `normaliseToUpsert()`. `createTestDatabase()` enables foreign keys so tests see desktop behavior.
- **Opening the Library**: `getAuthorDatabase()` retries a failed open (`DATABASE_OPEN_RETRY_DELAYS_MS`) and never caches a rejection. The web adapter rejects when saved bytes cannot be read and starts an empty Library only when nothing was ever saved; an empty fallback would be persisted over the author's Library by the first schema write. A Gallery whose load failed shows `LibraryLoadError`, never its empty state.
- **Buttons inside a collection row**: the row's keyboard path is its `GridListItem` `onAction`; never put an Enter/Space `onKeyDown` on a row's container, because it also catches the keys of the buttons inside the row and its `preventDefault` cancels their click (the Notes list shipped Edit, Duplicate and Delete inert to Enter this way). In a real browser React Aria can also turn an Enter or Space that bubbles out of a row's button into the row's action (`CanvasCard`'s `stopRowActionKey`). jsdom reproduces neither, so a row with buttons gets a block in `e2e/specs/row-controls.spec.ts`.
- **A caret in an inert editor**: while a React Aria keyboard drag makes the editor inert, a caret left in it costs Chromium a walk of the document on every focus change (about 1.5 ms per focus in a long Chapter, measured in issue #377; an open Modal makes the editor inert the same way). Every reorderable GridList passes its drag handlers through `useParkSelectionWhileDragging()` (Chapter list, Notes list, Toolbar Settings).
- **Live regions under a Modal**: an open `Modal` makes everything outside it inert, live regions included, so what they say meanwhile is never heard. A live region the app shell mounts outside the routes carries `data-live-announcer="true"` (the Dictation region, `RouteAnnouncer`), or `data-react-aria-top-layer` when it paints above the Modal (toasts). The guard is "the app shell's live regions" in `tutorial-app.test.tsx` (issue #336).
- **Database migrations**: Schema changes in `src/lib/db/index.ts` use `ALTER TABLE ... ADD COLUMN` wrapped in `.catch()` to handle "column already exists" — follow this pattern for new columns
- **TipTap content**: Chapter content is stored as TipTap JSON string in the database, not raw HTML. The export pipeline converts it via `processChapterHtml()`
- **Line height**: a block attribute on paragraph, heading, listItem, and taskItem (`src/components/editor/extensions/LineHeight.ts`), rendered as `line-height: X; --line-height: X`. Inside a list it goes on the closest list item so the marker follows. `.editor-content` derives paragraph and list item spacing from `--line-height` (`(L - 1) * 4/3 em`, exactly 1em at the default 1.75), so do not give editor paragraphs a fixed vertical margin. Older documents store inline `<span style="line-height">` on the `textStyle` mark: it still parses and renders byte for byte, but nothing writes it, and it can only make a line taller than its block. Do not use the CSS `lh` unit for this spacing: WebKit computed a stale value.
- **Word count**: Computed by stripping HTML tags and counting whitespace-separated tokens — see chapter store's `updateChapter`
- **Session restoration**: `StartupRedirect` restores the last visited path on app launch. If you add new routes, they will be automatically tracked by `PathTracker`

## Testing

### Architecture

Testing is configured with **Vitest + Testing Library + jsdom**, following a **phased coverage expansion** pattern (inspired by the kaont project).

- Test files: `src/test/**/*.test.ts` and `src/test/**/*.test.tsx`
- Test setup: `src/test/setup.ts`
- Support helpers: `src/test/support/` (fixtures, factories)
- Commands:
  - `pnpm test` (watch mode — TDD loop)
  - `pnpm test:run` (single run — CI)
  - `pnpm test:coverage` (coverage report with threshold enforcement)

### Coverage strategy

Coverage uses a **targeted include list** in `vite.config.ts` — only files with actual tests are measured. Each phase of testing adds new files to the list and ratchets thresholds upward.

**Current thresholds** (Phase 1 — pure logic):

| Metric     | Threshold |
| ---------- | --------- |
| Lines      | 80%       |
| Statements | 80%       |
| Functions  | 90%       |
| Branches   | 60%       |

**How to expand coverage:**

1. Write tests for a new file in `src/test/unit/` (or `src/test/integration/`)
2. Add the source file path to `coverage.include` in `vite.config.ts`
3. Verify thresholds still pass with `pnpm test:coverage`
4. Ratchet thresholds upward if the new file pushes averages above current limits

### Test patterns

**Pure function tests** (no mocks needed):

```ts
import { describe, expect, it } from "vitest";
import { someFunction } from "../../../../features/module/file";

describe("someFunction()", () => {
  it("describes expected behavior", () => {
    expect(someFunction(input)).toBe(expected);
  });
});
```

**Tests with platform mocks** (vi.hoisted + vi.mock):

```ts
const { mockFn } = vi.hoisted(() => ({ mockFn: vi.fn() }));
vi.mock("../../lib/platform", () => ({ getOS: mockFn }));
```

**Test fixtures** (shared factories in `src/test/support/fixtures.ts`):

```ts
import { buildBook, buildChapter } from "../../../support/fixtures";

const book = buildBook({ title: "Custom Title" });
const chapter = buildChapter({ content: "<p>Hello</p>" });
```

**DB-backed store tests** (in-memory sql.js + vi.mock):

```ts
import { vi, describe, it, expect, beforeEach } from "vitest";
import type { DatabaseAdapter } from "../../../../lib/platform/types";
import { createTestDatabase } from "../../../support/db-test-context";

let testDb: DatabaseAdapter;
const { mockGetDatabase } = vi.hoisted(() => ({ mockGetDatabase: vi.fn() }));
vi.mock("../../../../lib/db", () => ({ getDatabase: mockGetDatabase }));
const { useBookStore } = await import("../../../../features/books/store");

beforeEach(async () => {
  testDb = await createTestDatabase();
  mockGetDatabase.mockResolvedValue(testDb);
  useBookStore.setState({
    books: [],
    currentBook: null,
    isLoading: false,
    error: null,
  });
});
```

**Hook tests** (renderHook + fake timers):

```ts
import { renderHook, act } from "@testing-library/react";
import { vi } from "vitest";

vi.useFakeTimers();
const { result } = renderHook(() => useDebouncedCallback(callback, 300));
act(() => {
  result.current("arg");
});
act(() => {
  vi.advanceTimersByTime(300);
});
```

**Testing unexported helpers** — when a function is private (e.g., `hexToRgb`, `compareVersions`), replicate the logic in the test file and add a comment noting to switch to direct import if the function is ever exported.

### Phased rollout plan

| Phase                  | Scope                                                                                                                  | Status              |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------- |
| **1 — Pure logic**     | Export generators, styles, crypto, i18n, constants, cover/settings types, paste-handler transforms, version comparison | ✅ Done (127 tests) |
| **2 — Stores + hooks** | Zustand stores (in-memory sql.js DB), useAutoSave, useVersionCheck, useSettingsStore, useThemeStore, useSyncStore      | ✅ Done (231 tests) |
| **3 — UI components**  | UI primitives (Button, Modal, Input, Select, Switch, Toast, Combobox)                                                  | ✅ Done (305 tests) |
| **4 — Integration**    | Page rendering, routing, StartupRedirect, theme toggling, Layout, LoadingScreen                                        | ✅ Done (335 tests) |

### Time budget (no per-test timeouts)

Every test and hook runs on one timeout, `TEST_TIMEOUT_MS` (60 s), and every `waitFor`/`findBy*` on `ASYNC_UTIL_TIMEOUT_MS` (10 s), both in `src/test/time-budget.ts`. A hosted CI runner is about 2x slower than a laptop under coverage and varies up to 1.9x between runs, so the 5 s default and the per-file raises that followed each red run left tests at 80-100% of their limit (`docs/research/ci-549-vs-548.md`).

- **A test never sets its own timeout.** The setup file fails a test whose timeout is not the suite's; a file that truly needs longer goes in `TIMEOUT_EXCEPTIONS` with its reason. A timeout literal anywhere in a test file (`{ timeout: N }`, `}, N);`) needs a `// time-budget: <why>` comment on the line above (`test-time-budget.test.ts`).
- **A slow test gets cheaper, not a bigger limit.** Split a sweep into one test per case (see `navigating-commands.test.tsx`), query once instead of per keypress, render the section instead of the page.
- **The CI summary names the next timeouts.** The time budget reporter (`src/test/support/time-budget-reporter.ts`) runs on the merged CI report and annotates every test past half its timeout. The same summary is printed in the step log, retrievable with `gh run view --log`. It never fails the run: wall time on a shared runner is noise, and the timeout stays the only failure. Act on its list before a test crosses the line.

### TDD workflow

1. Write a failing test
2. Implement the minimum code to pass
3. Refactor safely with tests green

### Feature-critical test gate (current scope: sync safety + backups)

For changes in `src/features/backup/`, `src/features/sync/`, `src/features/versions/`, `src/lib/platform/*/backup.ts`, `src/lib/db/sql-parser.ts`, or the backup/sync/version UI that triggers destructive behavior, the feature is **not done** until tests cover the spec-critical paths.

Required coverage for the current sync-safety / backup / version-control feature:

1. **Pre-sync backup aborts sync** with the exact user-facing error required by the spec.
2. **Restore order is correct**: create `pre-restore` backup before verifying or mutating data.
3. **Invalid or empty backup inputs are safe**: restore must leave existing data untouched when checksum verification fails, parsing fails, or no allowed INSERT statements are found.
4. **Platform defaults and settings agree**: retention defaults, backup directory behavior, and platform-specific capabilities must be tested for both web and Tauri code paths where applicable.
5. **Adapter integrity rules are enforced**: checksum verification, orphan metadata handling, and quota-retry failure messaging must be covered by direct adapter tests.
6. **Conflict outcomes are truthful**: equal-timestamp conflicts, remote-only pulls, cancel behavior, and final sync status must be tested end-to-end through the store/UI flow.
7. **Lifecycle triggers are covered**: launch, close, manual, pre-sync, and pre-restore backup triggers must be tested at the orchestration layer.
8. **Shared destructive helpers are tested directly**: if a helper is extracted and used by restore/import/sync, it needs its own unit tests and must be added to `coverage.include`.
9. **Version restore and version sync are safe**: `restoreVersion` lands pending editor saves first (a failed save rejects before anything changes), creates a `pre-restore` version before applying the snapshot, bumps `updated_at` to now, and emits a local content Change through the shared Book write path; `syncVersions` verifies checksums before inserting pulled blobs; pure-union sync with no duplicates.
10. **Unsaved editor text is never dropped silently**: every sync run flushes open editors before its pre-sync backup or first read, and a failed save stops the run with a Sync Log error; a failed editor save shows Save Status "Not saved" and is retried on the next edit, Flush, or unmount. Test through `NoteEditor.dataSafety.test.tsx` and `BookEditor.dataSafety.test.tsx`.

Rules for this feature:

- Do **not** let tests codify spec drift. If the implementation intentionally changes the contract, update the design doc / plan and the tests in the same change.
- Do **not** keep destructive restore/sync orchestration only inside React components. Put it in feature services/stores so it can be tested without UI wiring.
- For this feature, passing tests should be enough to recreate confidence from scratch: every data-loss prevention guarantee must have at least one test that fails if the guarantee regresses.

### Keyboard and accessibility test gate (all interactive UI)

Any change that adds or modifies interactive UI is **not done** until behavioral keyboard tests exist:

1. **Test behavior, not attributes.** Asserting `tabIndex`, `role`, or `aria-*` values alone is insufficient — such tests have stayed green on widgets that were inoperable by keyboard. Use `@testing-library/user-event` to press the actual keys.
2. **Required coverage:**
   - Every user-facing action in the feature is exercised keyboard-only (arrows / Enter / Space / Escape / Tab as appropriate), asserting the resulting state or focus change.
   - Dialogs: Escape closes, and focus returns to the trigger element.
   - Lists / menus / toolbars: arrow keys move focus — assert `document.activeElement` changed, not that a handler is attached.
   - Reordering / drag-and-drop: the keyboard reorder path is tested end-to-end.
3. **New shortcuts** are tested through their `useShortcuts` binding: they fire when expected, are suppressed in typing targets (`isTypingTarget()` in `src/lib/keyboard.ts`), and the screen's test asserts its id is bound (`useBoundShortcutStore`).

### E2E (keyboard-first Playwright suite)

```bash
pnpm test:e2e                                     # guard, guard self-tests, e2e typecheck, web build, Playwright
pnpm test:e2e --project=chromium                  # one browser
pnpm test:e2e --project=phone                     # the @touch specs on a phone
pnpm test:e2e --project=voice                     # the audio specs (voice-*, dictation*), one at a time
pnpm test:e2e specs/books-create.spec.ts          # one file
pnpm test:e2e --grep @wf:books-create             # one matrix workflow
pnpm test:e2e --repeat-each=3                     # the acceptance run
pnpm test:e2e:sync                                # Sync lane: local PocketBase + maibuk-sync migrations, specs/sync/
```

The frame-rate lane (`pnpm bench:frames`, `e2e/frames/`) is a measurement, not
a spec: its drivers use the wheel and mouse drags where the measured gesture
is a pointer one, and the keyboard contract below does not apply to it.

Specs live in `e2e/specs/`. The suite drives the production web build in
Chromium and WebKit, runs locally, and is invisible to `pnpm test`,
`pnpm test:run`, `pnpm test:coverage`, the builds, release scripts, CI, and
hooks. It never runs in CI. `e2e/README.md` documents install, the full run,
single file/test/tag runs, headed, debug and UI mode, trace viewing, and
troubleshooting.

**Definition of done.** A new feature or new interactive UI is not done until it
has a row in `e2e/coverage-matrix.ts`, and a spec tagged `@wf:<row-id>` (and
`@sc:<id>` for each new shortcut) that passes locally with `pnpm test:e2e`; a
single file is fine while iterating (`pnpm test:e2e specs/<file>`). A gap whose
right interaction is undecided may stay `not-accepted` with a real GitHub issue
and `test.fail` citing it. Playwright never runs in CI (timing). CI runs only the
coverage guard through Vitest (`src/test/unit/e2e-coverage-guard.test.ts`),
which fails when a route, registry shortcut, or GLOSSARY.md term has no row, or a
row has no tagged spec. Running the specs is the author's local pre-PR check and
the first diagnosis tool when behavior breaks.

**Keyboard contract (every spec).** Enter each workflow through keyboard-reachable
UI and drive it with Tab, Shift+Tab, arrows, Enter, Space, Escape, and registered
shortcuts only. No spec uses `click`, `dblclick`, `hover`, `tap`, `dragTo`,
`check`, `fill`, `clear`, element `.focus()`, `locator.press`, `mouse`,
`touchscreen`, `dispatchEvent`, `evaluate`, or any other pointer or programmatic
API; the pre-run guard fails a spec that does. The one exception is touch:
`@touch` specs run only in the `phone` project and may `tap`, use
`touchscreen`, and import `e2e/support/touch.ts`; nothing else may. Locate elements by role and
accessible name, and assert the focused element and visible outcomes, never
component internals or store state. Every dialog spec asserts focus entry, Tab
containment (tabbing past the last control stays inside), Escape dismissal, and
focus restored to the trigger. Collection, menu, and toolbar specs assert that
the focused element changes on arrow keys. `data-testid` is allowed only where no
accessible name can exist, with a comment saying why. Press `ControlOrMeta` for
Mod; a spec that also runs in `mac-platform` presses the `mod` fixture.

**Adding a matrix row.** `e2e/coverage-matrix.ts` is the frozen minimum: one row
per workflow in `ROWS`, plus `EXCLUSIONS`. A row carries its `id`, `area`,
`workflow`, `edges` (each edge gets its own test), `terms`, `shortcuts`,
`routes`, `fixture`, `tags`, and `status`. Add it with `status: "planned"`,
write the spec, then set `status: "accepted"` once each edge passes in both
engines with `--repeat-each=3`. Specs declare coverage with `@wf:<id>` and
`@sc:<registry id>` tags in test or describe titles. A gap whose right
interaction is undecided stays `not-accepted` with an `issue` field (the GitHub
issue URL) and a test kept as
`test.fail(title, { annotation: { type: "issue", description: url } }, fn)`
citing that same URL. The guard fails an expected failure whose URL is missing
or not a real issue, and it fails a `test.fail()` that starts passing. Never add
`test.skip`, `test.fixme`, or `.only`, and never enable retries.

**Seed fixtures.** Named seed Libraries live in `e2e/support/seed/`, one file per
fixture, each registered in `SEED_LIBRARIES` (`e2e/support/seed/libraries.ts`).
A builder runs in Node through the app's real per-entity write paths against an
in-memory Library, and the file also exports the visible names its spec locates
by. `empty` is a fresh device and is the default; Tutorial specs set
`tutorialProgress: "clean"`. Only `e2e/support/storage.ts` and
`e2e/support/fault.ts` may touch IndexedDB or localStorage.
