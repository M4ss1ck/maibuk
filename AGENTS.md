# AGENTS.md — Maibuk Codebase Guide for AI Agents

## 1. Project Overview

**Maibuk** is a cross-platform writing application for book authors. It runs as a native desktop app (via Tauri 2.0 + Rust) and as a web app (via sql.js + browser APIs), sharing the same React frontend.

### Tech Stack

| Layer            | Technology                                                  |
| ---------------- | ----------------------------------------------------------- |
| UI Framework     | React 19 + TypeScript 5.8                                   |
| Bundler          | Vite 7                                                      |
| Native Shell     | Tauri 2.0 (Rust)                                            |
| Styling          | Tailwind CSS 4 + CSS custom properties                      |
| State            | Zustand 5 (with `persist` middleware for settings/theme)    |
| Routing          | React Router v7 (`react-router-dom`)                        |
| Rich Text Editor | TipTap 3.15                                                 |
| Version Diff/Sanitization | node-htmldiff + DOMPurify                         |
| Cover Designer   | Fabric.js 7                                                 |
| Database         | SQLite (Tauri plugin) / sql.js (web) via Drizzle ORM schema |
| i18n             | i18next + react-i18next (English, Spanish)                  |
| Icons            | Lucide React + custom SVGs in `src/components/icons/`       |
| Accessible UI    | React Aria 3 / React Aria Components 1                     |
| Package Manager  | pnpm 10                                                     |

### Entry Points

- **App bootstrap**: `src/main.tsx` — mounts React with `BrowserRouter > ThemeProvider > AppSettingsProvider > App`
- **Routing**: `src/App.tsx` — defines all routes, wraps in `StartupRedirect` + `PathTracker`
- **Tauri backend**: `src-tauri/src/lib.rs` / `main.rs`

### Routes

| Path                  | Component       | Layout                    |
| --------------------- | --------------- | ------------------------- |
| `/`                   | `Home`          | Sidebar layout (`Layout`) |
| `/settings`           | `Settings`      | Sidebar layout (`Layout`) |
| `/canvas`             | `CanvasGallery` | Sidebar layout (`Layout`) |
| `/ephemeral`          | `Ephemeral`     | Sidebar layout (`Layout`) |
| `/canvas/:canvasId`   | `Canvas`        | Full-page (no sidebar)    |
| `/book/:bookId`       | `BookEditor`    | Full-page (no sidebar)    |
| `/book/:bookId/cover` | `CoverDesigner` | Full-page (no sidebar)    |

---

## 2. Development Principles

### Keyboard & Accessibility Are Completion Requirements

Every new or modified UI feature ships keyboard-operable and screen-reader-correct, or it is **not done** — same standing as tests passing. Definition of done for any interactive UI:

1. **Fully operable by keyboard alone** — every action reachable without a mouse. Pointer-only interactions (drag-and-drop, hover-only controls, canvas gestures) need a keyboard path or an explicit, documented exemption in the PR.
2. **Focus is managed** — visible focus, dialogs trap and restore focus to their trigger, arrow-key navigation inside lists/menus/toolbars, Escape closes or exits.
3. **Library behavior, never hand-rolled focus code** — React Aria is the approved standard for dialogs, collections, roving focus, and keyboard-operable drag-and-drop. Do not hand-write roving tabindex, focus traps, or listbox key handling.
4. **Labels are localized** — every `aria-label` goes through i18n like any other user-visible string.
5. **Shortcuts are registered, not inlined** — new shortcuts go in `src/lib/shortcut-registry.ts` and bind via `useShortcuts` (`src/lib/shortcuts.ts`) so they surface in the shortcut help.
6. **Proven by behavioral tests** — see the Keyboard & Accessibility Test Gate in section 6.

Why this is a hard gate: this codebase has shipped UI whose ARIA attributes and `tabIndex` wiring looked correct while the widget was inoperable by keyboard, and attribute-level tests stayed green. Attributes are not accessibility; behavior is.

### DRY — Search Before Creating

Before writing any new utility, hook, component, or helper:

1. Search `src/hooks/` for existing hooks (`useAutoSave`, `useDebouncedCallback`)
2. Search `src/components/ui/` for existing UI components (`Button`, `Modal`, `Input`, `Select`, `Combobox`, `Switch`)
3. Search `src/lib/platform/` for platform abstractions (`DatabaseAdapter`, `FileSystemAdapter`, `DialogAdapter`, `OSAdapter`)
4. Search `src/features/*/types.ts` for existing type definitions
5. Search `src/features/*/store.ts` for existing store actions — stores already have full CRUD
6. Search `src/features/export/` for HTML/CSS processing utilities
7. Check `src/constants.ts` for app-wide constants

### Reusable Components First

If logic is used in more than one place, extract it:

- UI primitives → `src/components/ui/`
- React hooks → `src/hooks/`
- Platform operations → `src/lib/platform/`
- Feature logic → `src/features/<feature>/`

### Single Source of Truth

- App constants live in `src/constants.ts`
- Type definitions live in `src/features/<feature>/types.ts`
- Design tokens live in `src/index.css` under `@theme`
- Translation strings live in `src/locales/en.json` and `src/locales/es.json`
- Database schema lives in `src/lib/db/schema.ts`
- **Never** hardcode values that belong in these canonical locations

### Consistent Patterns

Mirror existing patterns exactly. When adding a new feature, follow the structure established by `books` or `chapters` features as templates.

---

## 3. Code Organization & Standards

### Directory Structure

```
src/
├── components/           # UI components (presentational)
│   ├── ui/              # Reusable primitives (Button, Modal, Input, etc.)
│   ├── editor/          # TipTap editor and toolbar
│   │   └── extensions/  # Custom TipTap extensions
│   ├── cover-editor/    # Fabric.js cover canvas and toolbar
│   ├── export/          # Export dialogs and previews
│   ├── sync/            # Sync status button, auth/passphrase dialogs, conflict dialog, sync panel
│   ├── settings/        # BackupSection, PasteCleanupSection
│   ├── project/         # Book card, new book dialog
│   ├── book/            # Book settings dialog
│   ├── canvas/          # Canvas gallery cards
│   └── icons/           # Custom SVG icon components
├── features/            # Feature modules (business logic + state)
│   ├── backup/          # backup-service.ts, generate-sql-dump.ts, lifecycle.ts, types.ts
│   ├── books/           # store.ts, types.ts
│   ├── chapters/        # store.ts, types.ts
│   ├── canvas/          # versioned docs, store, React Flow adapter, custom nodes
│   ├── covers/          # types.ts
│   ├── ephemeral/       # memory-only scratch buffer store
│   ├── export/          # generators, sanitizers, styles, types
│   ├── metrics/         # writing metrics types, classifier, repo, settings, session tracking
│   ├── notes/           # store.ts, types.ts
│   ├── reading-position/ # local-only editor caret/viewport persistence
│   ├── settings/        # store.ts, types.ts, AppSettingsProvider.tsx
│   ├── sync/            # store.ts, types.ts, crypto.ts, serializer.ts, client.ts, sync-engine.ts
│   ├── theme/           # store.ts
│   ├── version/         # useVersionCheck.ts (app update checker)
│   └── versions/        # store.ts, types.ts, useAutoCheckpoint.ts, sanitize.ts, compare.ts (book version control)
├── hooks/               # Shared React hooks
├── test/                # Test suites (unit/integration) + setup
├── lib/                 # Low-level infrastructure
│   ├── db/              # Database init + schema
│   └── platform/        # Cross-platform adapters (Tauri vs Web)
│       ├── tauri/       # Tauri implementations
│       └── web/         # Web/browser implementations
├── pages/               # Route-level page components
├── locales/             # i18n translation JSON files
├── assets/              # Static assets (images, fonts)
├── constants.ts         # App-wide constants
├── i18n.ts              # i18next configuration
└── index.css            # Tailwind imports + CSS custom properties
```

### Where New Files Go

| File type                   | Location                                                       |
| --------------------------- | -------------------------------------------------------------- |
| Reusable UI component       | `src/components/ui/`                                           |
| Feature-specific component  | `src/components/<feature>/`                                    |
| New feature (store + types) | `src/features/<name>/` with `store.ts`, `types.ts`, `index.ts` |
| Custom TipTap extension     | `src/components/editor/extensions/`                            |
| Shared hook                 | `src/hooks/` (and re-export from `src/hooks/index.ts`)         |
| Unit/Integration tests      | `src/test/unit/` and `src/test/integration/`                   |
| Platform adapter            | `src/lib/platform/tauri/` and `src/lib/platform/web/`          |
| Page component              | `src/pages/`                                                   |
| Translation keys            | `src/locales/en.json` and `src/locales/es.json`                |

### Naming Conventions

- **Components**: PascalCase files and exports — `BookCard.tsx`, `export function BookCard`
- **Hooks**: camelCase with `use` prefix — `useAutoSave.ts`, `export function useAutoSave`
- **Stores**: `store.ts` inside feature folder, export as `use<Feature>Store` — `useBookStore`, `useChapterStore`
- **Types**: `types.ts` inside feature folder, interfaces are PascalCase — `Book`, `CreateBookInput`, `UpdateBookInput`
- **Feature index**: `index.ts` barrel file re-exports public API from the feature
- **Constants**: UPPER_SNAKE_CASE — `APP_VERSION`, `DOWNLOAD_PAGE`
- **CSS variables**: `--color-<name>`, `--font-<name>`, `--spacing-<name>`

### Import Conventions

Imports follow this order (observed from existing code):

1. React / React DOM
2. Third-party libraries (`zustand`, `react-router-dom`, `@tiptap/*`, `react-aria-components`, `lucide-react`)
3. Internal imports via `@/` alias (`@/features/books`, `@/lib/db`, `@/hooks/useAutoSave`)
4. CSS imports (only in `main.tsx`)

The `@/` path alias maps to `src/` and is configured in both `tsconfig.json` (paths) and `vite.config.ts` (resolve.alias). All internal imports must use `@/` — never relative paths.

---

## 4. Component & Module Guidelines

### When to Create vs Extend

- **New component**: Only if the UI element doesn't exist in `src/components/ui/` and is genuinely distinct
- **Extend existing**: If you need a variant of `Button`, `Modal`, `Input`, etc., add a prop/variant to the existing component
- **New feature module**: Only for a genuinely new domain (not a sub-concern of an existing feature)

### Component Patterns

**Functional components with named exports** (no default exports for components):

```tsx
export function MyComponent({ prop }: MyComponentProps) { ... }
```

**Exception**: `forwardRef` components use `const` + named export:

```tsx
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(...)
Button.displayName = "Button";
```

**Dialog/Modal pattern** (uses the shared React Aria modal):

```tsx
<Modal isOpen={isOpen} onClose={onClose} title={title}>
  ...
</Modal>
```

### State Management

- **Server/persistent state**: Zustand stores in `src/features/*/store.ts` backed by SQLite
- **Persisted client state**: Zustand with `persist` middleware (settings, theme) → localStorage
- **Local component state**: `useState` / `useRef` for ephemeral UI state
- **No Context API for data** — Zustand handles all shared state. Context is only used for providers (`ThemeProvider`, `AppSettingsProvider`)

### Zustand Store Pattern

Every store follows this structure (see `src/features/books/store.ts`):

1. Private `generateId()` using `crypto.randomUUID()`
2. Private `toModel(row)` mapper from DB row to TypeScript interface
3. Interface declaring state + actions
4. `create<StoreInterface>()` with `set` — no `get` usage
5. Async actions that call `getDatabase()`, then `set()` to sync local state
6. Timestamps stored as Unix seconds: `Math.floor(Date.now() / 1000)`

### Existing Shared Utilities — CHECK BEFORE WRITING NEW ONES

| What                                                               | Where                                      |
| ------------------------------------------------------------------ | ------------------------------------------ |
| `useAutoSave(callback, delay)`                                     | `src/hooks/useAutoSave.ts`                 |
| `useDebouncedCallback(callback, delay)`                            | `src/hooks/useAutoSave.ts`                 |
| `useShortcuts(shortcuts, options)`                                 | `src/lib/shortcuts.ts`                     |
| `getDatabase()`                                                    | `src/lib/db/index.ts`                      |
| `exportDatabase()` / `importDatabase()` / `resetDatabase()`        | `src/lib/db/index.ts`                      |
| `createDatabase()` / `getFileSystem()` / `getDialog()` / `getOS()` | `src/lib/platform/index.ts`                |
| `IS_WEB` / `IS_TAURI`                                              | `src/lib/platform/index.ts`                |
| `setWindowAlwaysOnTop()`                                           | `src/lib/platform/index.ts`                |
| `isMac()`                                                          | `src/lib/platform/detect.ts`               |
| `processChapterHtml()` / `sanitizeHtmlForEpub()`                   | `src/features/export/html-sanitizer.ts`    |
| `cleanPastedHtml()` (configurable paste-cleanup engine)            | `src/components/editor/paste-cleanup.ts`   |
| `generateEpub()` / `generatePdfHtml()`                             | `src/features/export/`                     |
| `APP_VERSION` / `DOWNLOAD_PAGE`                                    | `src/constants.ts`                         |
| `detectSystemLocale()`                                             | `src/i18n.ts`                              |
| Font/size/language option arrays                                   | `src/features/settings/types.ts`           |
| `encrypt()` / `decrypt()`                                          | `src/features/sync/crypto.ts`              |
| `serializeBook()` / `applyBookSnapshot()`                          | `src/features/sync/serializer.ts`          |
| `syncBook()` / `syncAllBooks()`                                    | `src/features/sync/sync-engine.ts`         |
| PocketBase client (`initClient`, `login`, etc.)                    | `src/features/sync/client.ts`              |
| `useSyncStore`                                                     | `src/features/sync/store.ts`               |
| `useVersionStore`                                                  | `src/features/versions/store.ts`           |
| `useAutoCheckpoint`                                                | `src/features/versions/useAutoCheckpoint.ts` |
| `sanitizeChapterHtml()`                                            | `src/features/versions/sanitize.ts`        |
| `diffSnapshots()`                                                  | `src/features/versions/compare.ts`         |
| `useCanvasStore` / `parseCanvasDoc()` / `toFlowNodes()` (text nodes carry an optional persisted `width`) | `src/features/canvas/`                     |
| `createRichTextExtensions()` (canonical rich-text schema shared by the main editor, Quick Note, and canvas) | `src/components/editor/extensions/createRichTextExtensions.ts` |
| `MarkdownPasteDialog` / `plainTextToEditorHtml()` (shared markdown-paste prompt + plain-text conversion) | `src/components/editor/MarkdownPasteDialog.tsx` / `plain-text-html.ts` |
| `TableSizePicker` (reusable 5×5 table-dimension picker)            | `src/components/editor/TableSizePicker.tsx` |
| `useReadingPositionStore` / `useReadingPosition()`                 | `src/features/reading-position/`           |
| `toast.success()` / `ToastViewport`                                | `src/components/ui/Toast.tsx`              |
| `KeyboardShortcut` (`<kbd>` hint renderer)                         | `src/components/ui/KeyboardShortcut.tsx`   |
| `ResponsiveToggleGroup` (measured segmented toggle; labels collapse to icons only when full labels do not fit) | `src/components/ui/ResponsiveToggleGroup.tsx` |
| `MultiSelectCombobox` (multi-select chips, checkbox dropdown, optional custom values) | `src/components/ui/MultiSelectCombobox.tsx` |
| `buildBook()` / `buildChapter()` (test fixtures)                   | `src/test/support/fixtures.ts`             |
| `createTestDatabase()` (in-memory sql.js for store tests)          | `src/test/support/db-test-context.ts`      |
| `isTypingTarget()` / `isModKey()`                                  | `src/lib/keyboard.ts`                      |
| `BackupService` (create, prune, verify)                            | `src/features/backup/backup-service.ts`    |
| `generateSqlDump()`                                                | `src/features/backup/generate-sql-dump.ts` |
| `createLaunchBackup()` / `createCloseBackup()`                     | `src/features/backup/lifecycle.ts`         |
| `parseSqlStatements()`                                             | `src/lib/db/sql-parser.ts`                 |
| `createBackup()` (platform factory)                                | `src/lib/platform/index.ts`                |
| `computeChecksum()`                                                | `src/lib/checksum.ts`                      |
| `parseTriggerFromFilename()`                                       | `src/features/backup/utils.ts`             |
| `countWords()` / `classifyTransaction()`                           | `src/features/metrics/word-count.ts` / `classifier.ts` |
| `ensureMetricsSchema()` / `insertEvents()`                         | `src/features/metrics/events-repo.ts`      |
| `metricsService`                                                   | `src/lib/metrics/MetricsService.ts`        |
| `useNoteStore` / `saveCollapsedHeadings`                          | `src/features/notes/store.ts`              |
| `CollapsibleHeading` / `collapsibleHeadingPluginKey`              | `src/components/editor/extensions/CollapsibleHeading.ts` |
| `SceneBreakDescriptor` / scene-break attribute helpers             | `src/components/editor/extensions/scene-break-utils.ts` |
| `useModalScope(isOpen)` (LIFO modal ID registration/unregistration) | `src/hooks/useModalScope.ts`                 |

---

## 5. Styling & UI Conventions

### Tailwind CSS 4 with Semantic Tokens

All styling uses Tailwind utility classes inline. There are **no separate CSS files per component**.

Design tokens are defined as CSS custom properties in `src/index.css` under `@theme`:

| Token                 | Light     | Dark      | Usage                        |
| --------------------- | --------- | --------- | ---------------------------- |
| `--color-primary`     | `#3b82f6` | `#60a5fa` | `bg-primary`, `text-primary` |
| `--color-background`  | `#fafaf9` | `#1c1917` | `bg-background`              |
| `--color-foreground`  | `#1c1917` | `#fafaf9` | `text-foreground`            |
| `--color-muted`       | `#7a6f63` | `#44403c` | `bg-muted`                   |
| `--color-border`      | `#e7e5e4` | `#292524` | `border-border`              |
| `--color-card`        | `#ffffff` | `#292524` | `bg-card`                    |
| `--color-destructive` | `#ef4444` | `#f87171` | `bg-destructive`             |
| `--color-success`     | `#22c55e` | `#4ade80` | `text-success`               |

### Rules

- **Always use semantic tokens** (`bg-primary`, `text-foreground`, `border-border`) — never raw color values in components
- **Dark mode** is handled by toggling the `.dark` class on `<html>`, which swaps CSS variable values. No `dark:` prefixes needed in components
- **Spacing**: Use Tailwind spacing scale (`gap-2`, `px-4`, `py-2`). Custom spacing tokens: `--spacing-sidebar: 280px`, `--spacing-editor-max: 720px`
- **Typography**: Three font families defined — `font-sans` (Inter), `font-serif` (Literata), `font-mono`
- **Button variants**: `primary`, `secondary`, `ghost`, `destructive` — use the existing `Button` component, don't create ad-hoc button styles
- **Border radius**: Consistently `rounded-lg` across the codebase
- **Keyboard compatibility**: Any UI feature with interactive controls must meet the keyboard & accessibility completion requirements in section 2 and the test gate in section 6 — this is a definition-of-done item, not a styling preference

---

## 6. Testing & Quality

### Architecture

Testing is configured with **Vitest + Testing Library + jsdom**, following a **phased coverage expansion** pattern (inspired by the kaont project).

- Test files: `src/test/**/*.test.ts` and `src/test/**/*.test.tsx`
- Test setup: `src/test/setup.ts`
- Support helpers: `src/test/support/` (fixtures, factories)
- Commands:
  - `pnpm test` (watch mode — TDD loop)
  - `pnpm test:run` (single run — CI)
  - `pnpm test:coverage` (coverage report with threshold enforcement)

### Coverage Strategy

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

### Test Directory Structure

```
src/test/
├── setup.ts                    # Global setup (jest-dom, cleanup, ResizeObserver & matchMedia polyfills)
├── support/                    # Shared test helpers
│   ├── fixtures.ts             # buildBook(), buildChapter() factories
│   └── db-test-context.ts      # In-memory sql.js DatabaseAdapter for store tests
├── integration/                # Integration tests (components + routing + stores)
│   ├── Layout.test.tsx
│   ├── LoadingScreen.test.tsx
│   ├── PathTracker.test.tsx
│   ├── StartupRedirect.test.tsx
│   ├── ThemeProvider.test.tsx
│   └── ThemeToggle.test.tsx
└── unit/                       # Unit tests (mirror src/ structure)
    ├── constants.test.ts
    ├── i18n.test.ts
    ├── components/
    │   ├── editor/
    │   │   └── paste-handler.test.ts
    │   └── ui/
    │       ├── Button.test.tsx
    │       ├── Combobox.test.tsx
    │       ├── Input.test.tsx
    │       ├── Modal.test.tsx
    │       ├── MultiSelectCombobox.test.tsx
    │       ├── Select.test.tsx
    │       ├── Switch.test.tsx
    │       └── Toast.test.tsx
    ├── hooks/
    │   └── useAutoSave.test.ts
    └── features/
        ├── books/
        │   └── book-store.test.ts
        ├── chapters/
        │   └── chapter-store.test.ts
        ├── covers/
        │   └── cover-types.test.ts
        ├── export/
        │   ├── epub-generator.test.ts
        │   ├── epub-styles.test.ts
        │   ├── export-types.test.ts
        │   ├── html-sanitizer.test.ts
        │   ├── pdf-generator.test.ts
        │   └── pdf-styles.test.ts
        ├── settings/
        │   ├── app-settings-helpers.test.ts
        │   ├── settings-store.test.ts
        │   └── settings-types.test.ts
        ├── sync/
        │   ├── crypto.test.ts
        │   └── sync-store.test.ts
        ├── theme/
        │   └── theme-store.test.ts
        └── version/
            ├── compareVersions.test.ts
            └── useVersionCheck.test.ts
```

### Test Patterns

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

### Phased Rollout Plan

| Phase                  | Scope                                                                                                                  | Status              |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------- |
| **1 — Pure logic**     | Export generators, styles, crypto, i18n, constants, cover/settings types, paste-handler transforms, version comparison | ✅ Done (127 tests) |
| **2 — Stores + hooks** | Zustand stores (in-memory sql.js DB), useAutoSave, useVersionCheck, useSettingsStore, useThemeStore, useSyncStore      | ✅ Done (231 tests) |
| **3 — UI components**  | UI primitives (Button, Modal, Input, Select, Switch, Toast, Combobox)                                                  | ✅ Done (305 tests) |
| **4 — Integration**    | Page rendering, routing, StartupRedirect, theme toggling, Layout, LoadingScreen                                        | ✅ Done (335 tests) |

### TDD Workflow

1. Write a failing test
2. Implement the minimum code to pass
3. Refactor safely with tests green

### Feature-Critical Test Gate (current scope: sync safety + backups)

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
9. **Version restore and version sync are safe**: `restoreVersion` creates a `pre-restore` version before applying the snapshot, bumps `updated_at` to now, and `syncVersions` verifies checksums before inserting pulled blobs; pure-union sync with no duplicates.

Rules for this feature:

- Do **not** let tests codify spec drift. If the implementation intentionally changes the contract, update the design doc / plan and the tests in the same change.
- Do **not** keep destructive restore/sync orchestration only inside React components. Put it in feature services/stores so it can be tested without UI wiring.
- For this feature, passing tests should be enough to recreate confidence from scratch: every data-loss prevention guarantee must have at least one test that fails if the guarantee regresses.

### Keyboard & Accessibility Test Gate (all interactive UI)

Any change that adds or modifies interactive UI is **not done** until behavioral keyboard tests exist:

1. **Test behavior, not attributes.** Asserting `tabIndex`, `role`, or `aria-*` values alone is insufficient — such tests have stayed green on widgets that were inoperable by keyboard. Use `@testing-library/user-event` to press the actual keys.
2. **Required coverage:**
   - Every user-facing action in the feature is exercised keyboard-only (arrows / Enter / Space / Escape / Tab as appropriate), asserting the resulting state or focus change.
   - Dialogs: Escape closes, and focus returns to the trigger element.
   - Lists / menus / toolbars: arrow keys move focus — assert `document.activeElement` changed, not that a handler is attached.
   - Reordering / drag-and-drop: the keyboard reorder path is tested end-to-end.
3. **New shortcuts** are tested through their `useShortcuts` binding: they fire when expected and are suppressed in typing targets (`isTypingTarget()` in `src/lib/keyboard.ts`).

### Linting & Formatting

There is **no ESLint or Prettier configured** in the project. TypeScript strict mode (`tsconfig.json`) serves as the primary code quality gate.

### Type Safety

- `strict: true` in `tsconfig.json`
- All feature types defined in `types.ts` files
- Database rows typed as `Record<string, unknown>` with manual mapping via `toModel()` functions
- Platform adapters have explicit interface contracts in `src/lib/platform/types.ts`

---

## 7. Documentation Requirements

### Comments

- Focus on **why**, not **what** — the code should be self-explanatory
- Match existing style: the codebase has minimal comments, only where logic isn't obvious
- Do not add JSDoc/docstrings unless the function is a public API with non-obvious parameters

### Updating AGENTS.md

Update this file when:

- A new feature module is added to `src/features/`
- A new shared hook or utility is created
- A new reusable UI component is added to `src/components/ui/`
- The directory structure changes significantly
- New design tokens or CSS conventions are introduced

### i18n

Every user-visible string must use `useTranslation()` and have keys in both `src/locales/en.json` and `src/locales/es.json`. Do not hardcode UI text.

---

## 8. Common Pitfalls & Anti-patterns

### DO NOT

- **Create new UI primitives** without checking `src/components/ui/` first — `Button`, `Modal`, `Input`, `Select`, `Combobox`, `Switch` already exist
- **Import Tauri APIs directly** — always go through `src/lib/platform/` adapters so the web build works
- **Use `Date.now()` for DB timestamps** — the database stores Unix seconds: `Math.floor(Date.now() / 1000)`
- **Use raw color values** in components — always use semantic Tailwind tokens (`bg-primary`, not `bg-blue-500`)
- **Add `dark:` prefixes** in Tailwind classes — dark mode is handled by CSS variable swaps, not Tailwind dark variants
- **Use `default export`** for components — the codebase uses named exports everywhere (only `App.tsx` is a default export)
- **Create new Zustand stores** for data that belongs in an existing store — check `books`, `chapters`, `settings`, `theme` stores first
- **Use React Context for shared state** — use Zustand. Context is only for providers
- **Skip barrel exports** — every feature module needs an `index.ts` that re-exports its public API
- **Hardcode strings** shown to users — use i18n translation keys
- **Use relative imports** — always use `@/` prefix for all internal imports
- **Use `get()` inside Zustand stores** — existing stores only use `set()`
- **Hand-roll focus management** — no bespoke roving tabindex, focus traps, or listbox key handling; use React Aria behavior (see section 2)
- **Ship pointer-only interactions** — drag-and-drop, hover-only controls, and canvas gestures need a keyboard-accessible path
- **Prove keyboard support with attribute assertions** — tests must press keys via `user-event` and assert behavior, not check `tabIndex`/`aria-*` values (see section 6 test gate)

### Known Footguns

- **Platform branching**: `IS_WEB` and `IS_TAURI` are build-time constants. Test both targets when touching platform code
- **Database migrations**: Schema changes in `src/lib/db/index.ts` use `ALTER TABLE ... ADD COLUMN` wrapped in `.catch()` to handle "column already exists" — follow this pattern for new columns
- **TipTap content**: Chapter content is stored as TipTap JSON string in the database, not raw HTML. The export pipeline converts it via `processChapterHtml()`
- **Word count**: Computed by stripping HTML tags and counting whitespace-separated tokens — see chapter store's `updateChapter`
- **Session restoration**: `StartupRedirect` restores the last visited path on app launch. If you add new routes, they will be automatically tracked by `PathTracker`

---

## 9. Key Commands

```bash
# Development
pnpm dev              # Tauri dev (Vite + Rust hot reload)
pnpm dev:web          # Web-only dev (VITE_BUILD_TARGET=web)
pnpm test             # Tests in watch mode (TDD loop)
pnpm test:run         # Tests once (CI)
pnpm test:coverage    # Coverage report

# Build
pnpm build            # TypeScript check + Vite build (for Tauri)
pnpm build:web        # Web static build
pnpm build:linux      # Linux binary
pnpm build:windows    # Windows cross-compile
pnpm build:android    # Android APK

# Other
pnpm preview          # Preview production build
pnpm preview:web      # Preview web build
pnpm version:bump     # Bump version via script
pnpm tauri            # Direct Tauri CLI access
```

---

## 10. Design Context

### Users

Indie book authors — power users who value minimalism and craft. They come to Maibuk in **creative flow** mode: they want to disappear into their writing, not manage a project. The interface should remove friction, stay out of the way during writing, and feel satisfying during the moments they do interact with it (organizing chapters, exporting, designing covers). These are people who chose a dedicated writing tool over Google Docs — they care about the experience.

### Brand Personality

**Bold · Creative · Modern**

Maibuk is confident, not timid. It has opinions about how writing software should feel. It's modern without being trendy — no chasing aesthetic fads. It's creative in the sense that it respects the creative process: it knows when to be invisible (writing) and when to delight (interactions, transitions, feedback). It never feels corporate, generic, or template-driven.

### Aesthetic Direction

- **Warm, grounded palette**: Stone-based neutrals (`stone-50` → `stone-950`) with user-customizable primary accent. The warmth is intentional — it avoids the cold, clinical feel of pure grays. Keep it.
- **Editorial confidence**: Typography-driven hierarchy, generous whitespace during writing, tight purposeful density in toolbars and sidebars. Think magazine editorial layout sensibility applied to a tool.
- **Own identity**: Maibuk should never look like "a React template" or "another Electron app." Every design decision should feel intentional. If a user showed the interface to someone, they should recognize it as _Maibuk_, not "some writing app."
- **No anti-references needed** — the directive is simply: never be generic.
- **Theme**: Light and dark modes via CSS variable swap (`.dark` class). No `dark:` Tailwind prefixes. The warm stone palette already provides good differentiation between themes.

### Design Principles

1. **Flow first** — The writing experience is sacred. The editor should feel like a blank page with superpowers hidden beneath the surface. Progressive disclosure: simple by default, powerful on demand.
2. **Intentional density** — Toolbars, sidebars, and settings can be dense, but every element must earn its space. No decorative padding, no filler icons, no redundant labels. Tight where it should be tight, spacious where it should be spacious.
3. **Confident restraint** — Bold doesn't mean loud. The interface should feel decisive — clear hierarchy, strong primary actions, no ambiguity about what to do next. But it achieves this through restraint: fewer elements with more purpose, not more elements with less.
4. **Tangible feedback** — Every interaction should feel responsive and real. Save status, sync state, export progress, drag-and-drop reordering — these moments are where trust is built. Invest in making them feel right.
5. **Never generic** — Before adding any UI element, ask: "Would this look the same in a generic template?" If yes, reconsider. Maibuk's identity comes from the accumulation of small, intentional choices — a distinctive empty state, a satisfying hover effect, a well-crafted transition.


<!-- headroom:rtk-instructions -->
# RTK (Rust Token Killer) - Token-Optimized Commands

When running shell commands, **always prefix with `rtk`**. This reduces context
usage by 60-90% with zero behavior change. If rtk has no filter for a command,
it passes through unchanged — so it is always safe to use.

## Key Commands
```bash
# Git (59-80% savings)
rtk git status          rtk git diff            rtk git log

# Files & Search (60-75% savings)
rtk ls <path>           rtk read <file>         rtk grep <pattern>
rtk find <pattern>      rtk diff <file>

# Test (90-99% savings) — shows failures only
rtk pytest tests/       rtk cargo test          rtk test <cmd>

# Build & Lint (80-90% savings) — shows errors only
rtk tsc                 rtk lint                rtk cargo build
rtk prettier --check    rtk mypy                rtk ruff check

# Analysis (70-90% savings)
rtk err <cmd>           rtk log <file>          rtk json <file>
rtk summary <cmd>       rtk deps                rtk env

# GitHub (26-87% savings)
rtk gh pr view <n>      rtk gh run list         rtk gh issue list

# Infrastructure (85% savings)
rtk docker ps           rtk kubectl get         rtk docker logs <c>

# Package managers (70-90% savings)
rtk pip list            rtk pnpm install        rtk npm run <script>
```

## Rules
- In command chains, prefix each segment: `rtk git add . && rtk git commit -m "msg"`
- For debugging, use raw command without rtk prefix
- `rtk proxy <cmd>` runs command without filtering but tracks usage
<!-- /headroom:rtk-instructions -->
