# AGENTS.md — Maibuk Codebase Guide for AI Agents

## 1. Project Overview

**Maibuk** is a cross-platform writing application for book authors. It runs as a native desktop app (via Tauri 2.0 + Rust) and as a web app (via sql.js + browser APIs), sharing the same React frontend.

### Tech Stack

| Layer                     | Technology                                                  |
| ------------------------- | ----------------------------------------------------------- |
| UI Framework              | React 19 + TypeScript 5.8                                   |
| Bundler                   | Vite 7                                                      |
| Native Shell              | Tauri 2.0 (Rust)                                            |
| Styling                   | Tailwind CSS 4 + CSS custom properties                      |
| State                     | Zustand 5 (with `persist` middleware for settings/theme)    |
| Routing                   | React Router v7 (`react-router-dom`)                        |
| Rich Text Editor          | TipTap 3.15                                                 |
| Version Diff/Sanitization | node-htmldiff + DOMPurify                                   |
| Cover Designer            | Fabric.js 7                                                 |
| Database                  | SQLite (Tauri plugin) / sql.js (web) via Drizzle ORM schema |
| i18n                      | i18next + react-i18next (English, Spanish)                  |
| Icons                     | Lucide React + custom SVGs in `src/components/icons/`       |
| Accessible UI             | React Aria 3 / React Aria Components 1                      |
| Package Manager           | pnpm 10                                                     |

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

### Domain Language and Decisions Come First

Before naming anything or proposing a restructure, read:

1. **`CONTEXT.md`**: the domain glossary. New identifiers, UI copy, test names, commit messages, and docs use its terms (Book, Checkpoint, Unfiled Note, Deleted Elsewhere...). A word listed under a term's _Avoid_ is a review flag.
   - Terms in the main sections describe how the app works today.
   - Terms under **Decided, not built** have an accepted ADR the code has not caught up with. Until a change implements that ADR, new code uses the current mechanism (for example, Canvases do not sync until a Canvas adapter for Entity Sync ships). Use an ADR term only for something that already behaves as the term defines; otherwise refer to the current mechanism by its code name (`refreshBooks`) and do not coin a synonym. Implementing an ADR is its own change.
   - Terms under **Anticipated** are reserved names for features nobody has decided to build. Use them if that feature is built instead of inventing a synonym.
   - A `_UI_` label marked _(known mismatch)_ is shipped copy that contradicts the glossary. It may be fixed in a dedicated copy change or in any change that already touches that screen; neither is required. The fix updates both locale files and, in the same commit, edits only the mismatched part of that `_UI_` line in `CONTEXT.md`: the new label replaces the old one and the _(known mismatch)_ marker goes. Correct labels on the same line stay. A label that only becomes wrong once a **Decided, not built** term ships is changed by the change implementing that ADR, not before.
2. **`docs/adr/`**: architecture decisions. `status: accepted (not implemented)` means decided but not yet in the code. Do not re-propose an alternative an ADR rejected unless you can name what changed; if you do, write a new ADR that supersedes it.

An existing identifier that uses an avoided word may be renamed by a change that already touches it; that change is not required to rename it, and no change renames identifiers in a sweep. A user-visible rename changes the string in both `en.json` and `es.json` in the same commit.

When a new domain concept appears, add it to `CONTEXT.md` in the same change: one or two sentences saying what it is, no implementation details. Record a decision as an ADR only when it is hard to reverse, would surprise a future reader, and came from a real trade-off.

### Keyboard & Accessibility Are Completion Requirements

Every new or modified UI feature ships keyboard-operable and screen-reader-correct, or it is **not done** — same standing as tests passing. Definition of done for any interactive UI:

1. **Fully operable by keyboard alone** — every action reachable without a mouse. Pointer-only interactions (drag-and-drop, hover-only controls, canvas gestures) need a keyboard path or an explicit, documented exemption in the PR.
2. **Focus is managed** — visible focus, dialogs trap and restore focus to their trigger, arrow-key navigation inside lists/menus/toolbars, Escape closes or exits.
3. **Library behavior, never hand-rolled focus code** — React Aria is the approved standard for dialogs, collections, roving focus, and keyboard-operable drag-and-drop. Do not hand-write roving tabindex, focus traps, or listbox key handling.
4. **Labels are localized** — every `aria-label` goes through i18n like any other user-visible string.
5. **Shortcuts are registered, not inlined** — new shortcuts go in `src/lib/shortcut-registry.ts` and bind via `useShortcuts` (`src/lib/shortcuts.ts`) with the registry `id` on the entry. That id is what makes it a Bound Shortcut listed under "On this screen" in the help. A key handled elsewhere (a component's own `onKeyDown`, a native control) declares its id with `useBoundShortcutIds`; TipTap formatting keys are tagged `source: "editor-keymap"` and listed from each editor's real keymap. `shortcut-bindings.test.ts` fails when a registry id is bound nowhere.
6. **Proven by behavioral tests** — see the Keyboard & Accessibility Test Gate in section 6.
7. **Reachable by touch** — Android and phone browsers have no hover, and Tailwind 4 only applies `hover:`/`group-hover:` where hover exists. Mouse devices keep their hover-revealed one-click actions; the same element gets `pointer-coarse:hidden`, and touch screens get the actions another way: an item's actions go in a ⋯ `ItemActionsMenu` shown with `hidden pointer-coarse:inline-flex` (or an `ItemActionsPopover` for Canvas nodes), opened also by long-press through `useItemContextMenu`; a single action becomes a visible control on coarse pointers. `src/test/unit/touch-reachability.test.ts` fails on a hover reveal with no `pointer-coarse:` class unless it is listed there with its touch path. Long-press opens the Item Menu, so on touch a drag starts only from a `data-drag-handle` (wrap the list in `useTouchDragFromHandle`). Remember where phones actually browse: on a phone the Notes gallery, not the notes list, is how notes are reached.

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
│   ├── tutorial/        # TutorialRunner (Joyride + inert boundary), TutorialCard (React Aria dialog), TutorialOffer
│   └── icons/           # Custom SVG icon components
├── features/            # Feature modules (business logic + state)
│   ├── backup/          # backup-service.ts, generate-sql-dump.ts, lifecycle.ts, types.ts
│   ├── books/           # store.ts, types.ts
│   ├── chapters/        # store.ts, types.ts
│   ├── canvas/          # versioned docs, store, React Flow adapter, custom nodes
│   ├── covers/          # types.ts
│   ├── edit-session/    # createEditSession (framework-free), useEditSession hook
│   ├── ephemeral/       # memory-only scratch buffer store
│   ├── export/          # generators, sanitizers, styles, types
│   ├── metrics/         # writing metrics types, classifier, repo, settings, session tracking
│   ├── notes/           # store.ts, types.ts
│   ├── reading-position/ # local-only editor caret and Canvas viewport persistence (never synced, ADR 0004)
│   ├── settings/        # store.ts, types.ts, AppSettingsProvider.tsx
│   ├── sync/            # store.ts, types.ts, crypto.ts, serializer.ts, client.ts, sync-engine.ts, entity-sync.ts, remote-port.ts
│   ├── theme/           # store.ts
│   ├── tutorial/        # Tutorial + Tutorial Library switch (ADR 0008/0009): library-switch.ts, tutorial-library.ts, sample-library.ts, sections.ts, store.ts, controller.ts
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

### Synced entity writes

Book, Chapter, Note, and Canvas mutations go through `src/features/books/write.ts`, `src/features/chapters/write.ts`, `src/features/notes/write.ts`, and `src/features/canvas/write.ts`. These paths own normalization, persistence, stored return values, and the Change Feed. Stores remain in-memory views. Restore, Import, and the sync serializer use the same paths.

A Chapter Change identifies its containing Book. Every local Change schedules Auto Sync, including metadata. Last Edited advances for content and title changes; pin, order, and status leave it unchanged. Publish only after persistence; tests must cover failed writes, partial multi-write failures, origin, and the resulting view refresh.

### The Tutorial Library switch (ADR 0008)

While the Tutorial runs, `getDatabase()` returns an in-memory Tutorial Library (`src/features/tutorial/library-switch.ts`). The author's own database is `getAuthorDatabase()`. Rules for every change:

- **Every background job that touches the Library checks `isTutorialLibraryActive()` and does nothing while it is on**, with a test proving it. Today: Auto Sync (launch and idle), the sync store and sync engine, daily/background Backups and `BackupService.createBackup`, idle and close Checkpoints, `metricsService` (record, mark active, flush), Reading Position saves, and last-location tracking (`setLastPath`/`setLastNoteId` check `isTutorialRunInProgress()`). A new job joins this list in the same change.
- **Fire-and-forget work against the author's Library** (like the Book Editor's close Checkpoint) is wrapped in `trackAuthorLibraryWork()`, so a switch waits for it.
- **A store that caches Library rows** is listed in `LIBRARY_VIEWS` (`src/features/tutorial/tutorial-library.ts`) with how it empties and re-reads on a switch.
- **Sample ids start with `tutorial-`**. Every per-entity write path calls `assertWritableId()` on ids it did not generate; a new write path does the same.
- Sample content is built through the real write paths (`sample-library.ts`) from `tutorial.sample.*` strings in both locales.

### Tutorial steps and anchors

Steps live in `src/features/tutorial/sections.ts`. A step points at the element carrying `data-tutorial="<section>.<step>"`; never at a label or class. When a control a step points at is renamed, moved, or removed, move its `data-tutorial` attribute with it: `tutorial-app.test.tsx` renders every step on its screen and fails when a target is missing. A new glossary term in `CONTEXT.md` is either added to a step's `terms` or listed in `TUTORIAL_OUT_OF_SCOPE_TERMS` with a reason (`gates.test.ts`). While a run is active the app is `inert` and only the `tutorial.skip` shortcut works.

### Zustand Store Pattern

Every store follows this structure (see `src/features/books/store.ts`):

1. Private `generateId()` using `crypto.randomUUID()`
2. Private `toModel(row)` mapper from DB row to TypeScript interface
3. Interface declaring state + actions
4. `create<StoreInterface>()` with `set` — no `get` usage
5. Async actions that call `getDatabase()`, then `set()` to sync local state
6. Timestamps stored as Unix seconds: `Math.floor(Date.now() / 1000)`

### Existing Shared Utilities — CHECK BEFORE WRITING NEW ONES

| What                                                                                                                                                                                                                                           | Where                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `useAutoSave(callback, delay)`                                                                                                                                                                                                                 | `src/hooks/useAutoSave.ts`                                             |
| `useDebouncedCallback(callback, delay)` (stable identity, `.cancel()` drops the pending call, `.flush()` runs it now; not for saves, which use `useEditSession`)                                                                               | `src/hooks/useAutoSave.ts`                                             |
| `EditorHandle` (`<Editor ref>`; `flush()` hands the coalesced typing burst to `onUpdate` synchronously)                                                                                                                                        | `src/components/editor/Editor.tsx`                                     |
| `createEditSession()` / `useEditSession()` (one Edit Session per open Chapter, Note, or Canvas: debounced save, Save Status, Flush registration, echo check against the content the last save returned; `Editor` never guesses echoes)                  | `src/features/edit-session/`                                           |
| `useShortcuts(shortcuts, options)` (an entry's registry `id` lists it as a Bound Shortcut while mounted and enabled)                                                                                                                           | `src/lib/shortcuts.ts`                                                 |
| `useBoundShortcutIds(ids, enabled)` / `useBoundShortcuts()` (declare keys handled outside `useShortcuts`; read what works on this screen)                                                                                                      | `src/lib/bound-shortcuts.ts`                                           |
| `editorKeymapShortcutIds(editor)` (the `editor-keymap` registry shortcuts a TipTap editor's extensions really bind)                                                                                                                            | `src/components/editor/keymap-shortcuts.ts`                            |
| `getDatabase()`                                                                                                                                                                                                                                | `src/lib/db/index.ts`                                                  |
| `exportDatabase()` / `importDatabase()` / `resetDatabase()`                                                                                                                                                                                    | `src/lib/db/index.ts`                                                  |
| `createDatabase()` / `getFileSystem()` / `getDialog()` / `getOS()`                                                                                                                                                                             | `src/lib/platform/index.ts`                                            |
| `IS_WEB` / `IS_TAURI`                                                                                                                                                                                                                          | `src/lib/platform/index.ts`                                            |
| `setWindowAlwaysOnTop()`                                                                                                                                                                                                                       | `src/lib/platform/index.ts`                                            |
| `isMac()`                                                                                                                                                                                                                                      | `src/lib/platform/detect.ts`                                           |
| `processChapterHtml()` / `sanitizeHtmlForEpub()`                                                                                                                                                                                               | `src/features/export/html-sanitizer.ts`                                |
| `cleanPastedHtml()` (configurable paste-cleanup engine)                                                                                                                                                                                        | `src/components/editor/paste-cleanup.ts`                               |
| `generateEpub()` / `generatePdfHtml()`                                                                                                                                                                                                         | `src/features/export/`                                                 |
| `APP_VERSION` / `DOWNLOAD_PAGE`                                                                                                                                                                                                                | `src/constants.ts`                                                     |
| `detectSystemLocale()`                                                                                                                                                                                                                         | `src/i18n.ts`                                                          |
| Font/size/language option arrays                                                                                                                                                                                                               | `src/features/settings/types.ts`                                       |
| `encrypt()` / `decrypt()`                                                                                                                                                                                                                      | `src/features/sync/crypto.ts`                                          |
| `stringifySnapshotAsync()` / `encryptToBuffer()` / `computeChecksumAsync()` / `dumpHasDataAsync()` (sync CPU codec worker)                                                                                                                     | `src/features/sync/sync-codec.ts`                                      |
| `serializeBook()` / `applyBookSnapshot()`                                                                                                                                                                                                      | `src/features/sync/serializer.ts`                                      |
| `syncBook()` / `syncAllBooks()`                                                                                                                                                                                                                | `src/features/sync/sync-engine.ts`                                     |
| `syncEntity()` / `syncEntityBatch()` / `pullEntity()` / `processPendingDeletions()` (Entity Sync: one flow over per-kind adapters)                                                                                                             | `src/features/sync/entity-sync.ts`                                     |
| `EntityRemote` / `pocketBaseRemote` (Remote port; `InMemoryRemote` in `src/test/support/in-memory-remote.ts` for tests)                                                                                                                        | `src/features/sync/remote-port.ts`                                     |
| PocketBase client (`initClient`, `login`, etc.)                                                                                                                                                                                                | `src/features/sync/client.ts`                                          |
| `useSyncStore`                                                                                                                                                                                                                                 | `src/features/sync/store.ts`                                           |
| `shouldRefreshAuth()` / `getTokenExpiryMs()` (auth token renewal policy)                                                                                                                                                                       | `src/features/sync/auth-policy.ts`                                     |
| `installAuthKeepAlive()` (renews the sync session while the app runs)                                                                                                                                                                          | `src/features/sync/auth-keep-alive.ts`                                 |
| `buildTestJwt(expiresAtMs)` (JWT-shaped test token)                                                                                                                                                                                            | `src/test/support/jwt.ts`                                              |
| `decideSyncAction()` (pure three-way push/pull/conflict decision against the last-synced base)                                                                                                                                                 | `src/features/sync/sync-decision.ts`                                   |
| `getSyncBase()` / `setSyncBase()` / `clearAllSyncBases()` (per-device `sync_state` table, not backed up)                                                                                                                                       | `src/features/sync/sync-state.ts`                                      |
| `installAutoSync()` / `runAutoSync()` (launch + idle-after-edit automatic sync, `autoSync` setting)                                                                                                                                            | `src/features/sync/auto-sync.ts`                                       |
| `emitChange()` / `onChange()` (Change Feed; per-entity write paths publish persisted Changes, Auto Sync consumes local Changes)                                                                                                                        | `src/features/sync/change-feed.ts`                                   |
| `registerPendingEditsFlush()` / `flushPendingEdits()` (editors land unsaved text, including the Editor's coalescing burst, before a sync run or Version restore; rejects with `PendingEditsFlushError` when a save fails, which stops the run) | `src/features/sync/pending-edits.ts`                                   |
| `useVersionStore`                                                                                                                                                                                                                              | `src/features/versions/store.ts`                                       |
| `useAutoCheckpoint`                                                                                                                                                                                                                            | `src/features/versions/useAutoCheckpoint.ts`                           |
| `sanitizeChapterHtml()`                                                                                                                                                                                                                        | `src/features/versions/sanitize.ts`                                    |
| `diffSnapshots()`                                                                                                                                                                                                                              | `src/features/versions/compare.ts`                                     |
| `useCanvasStore` / `parseCanvasDoc()` / `toFlowNodes()` (text nodes carry an optional persisted `width`)                                                                                                                                       | `src/features/canvas/`                                                 |
| `createRichTextExtensions()` (canonical rich-text schema shared by the main editor, Quick Note, and canvas)                                                                                                                                    | `src/components/editor/extensions/createRichTextExtensions.ts`         |
| `loadEmojiSymbols()` (lazy, localized emoji/symbol autocomplete catalog)                                                                                                                                                                       | `src/features/symbols/load.ts`                                         |
| `MarkdownPasteDialog` / `plainTextToEditorHtml()` (shared markdown-paste prompt + plain-text conversion)                                                                                                                                       | `src/components/editor/MarkdownPasteDialog.tsx` / `plain-text-html.ts` |
| `TableSizePicker` (reusable 5×5 table-dimension picker)                                                                                                                                                                                        | `src/components/editor/TableSizePicker.tsx`                            |
| `getEditorToolbarState()` (one shared formatting snapshot per immutable editor state)                                                                                                                                                          | `src/components/editor/toolbar/editor-toolbar-state.ts`                |
| `useReadingPositionStore` / `useReadingPosition()`                                                                                                                                                                                             | `src/features/reading-position/`                                       |
| `toast.success()` / `ToastViewport`                                                                                                                                                                                                            | `src/components/ui/Toast.tsx`                                          |
| `FileDropImportStatus` (localized file-import progress overlay)                                                                                                                                                                                | `src/components/ui/FileDropImportStatus.tsx`                           |
| `pickTextFiles()` (keyboard path to import Markdown/text Chapters; the drop gesture stays pointer-only)                                                                                                                                        | `src/hooks/useTextFileDrop.ts`                                         |
| `KeyboardShortcut` (`<kbd>` hint renderer)                                                                                                                                                                                                     | `src/components/ui/KeyboardShortcut.tsx`                               |
| `ResponsiveToggleGroup` (measured segmented toggle; labels collapse to icons only when full labels do not fit)                                                                                                                                 | `src/components/ui/ResponsiveToggleGroup.tsx`                          |
| `MultiSelectCombobox` (multi-select chips, checkbox dropdown, optional custom values)                                                                                                                                                          | `src/components/ui/MultiSelectCombobox.tsx`                            |
| `Checkbox` (React Aria checkbox with mixed state; `label` is its accessible name, `inputRef` for focus) | `src/components/ui/Checkbox.tsx` |
| `ItemActionsMenu` / `ItemActionsPopover` (always-visible ⋯ button, or a popover anchored to the item, with a React Aria menu of its actions; submenus via `children`) | `src/components/ui/ItemActionsMenu.tsx`                                |
| `useItemContextMenu({ onOpen })` / `useTouchDragFromHandle()` (touch long-press and right-click open the item menu; touch drags start only from `data-drag-handle`)                                                                            | `src/hooks/useItemContextMenu.ts`                                      |
| `installPointerEvent()` / `touchLongPress()` / `touchTap()` (jsdom touch-gesture test helpers)                                                                                                                                                 | `src/test/support/pointer-events.ts`                                   |
| `buildBook()` / `buildChapter()` (test fixtures)                                                                                                                                                                                               | `src/test/support/fixtures.ts`                                         |
| `createTestDatabase()` (in-memory sql.js for store tests)                                                                                                                                                                                      | `src/test/support/db-test-context.ts`                                  |
| `isTypingTarget()` / `isModKey()`                                                                                                                                                                                                              | `src/lib/keyboard.ts`                                                  |
| `BackupService` (create, prune, verify, `deleteBackups` bulk delete that reports failures)                                                                                                                                                                                                        | `src/features/backup/backup-service.ts`                                |
| `generateSqlDump()`                                                                                                                                                                                                                            | `src/features/backup/generate-sql-dump.ts`                             |
| `createLaunchBackup()` / `createCloseBackup()`                                                                                                                                                                                                 | `src/features/backup/lifecycle.ts`                                     |
| `parseSqlStatements()`                                                                                                                                                                                                                         | `src/lib/db/sql-parser.ts`                                             |
| `exportSqlDump()` (paged SQL export with worker formatting)                                                                                                                                                                                    | `src/lib/db/sql-export.ts`                                             |
| `createAsyncQueue()` (FIFO serialization that advances after failures)                                                                                                                                                                         | `src/lib/async-queue.ts`                                               |
| `createBackup()` (platform factory)                                                                                                                                                                                                            | `src/lib/platform/index.ts`                                            |
| `getDefaultBackupDirectory()` / `pickBackupDirectory()` / `requestBackupDirectory()` / `restoreBackupDirectory()` / `forgetBackupDirectory()` (Backup Directory: displayed default; approval only through native UI, ADR 0010)                 | `src/lib/platform/index.ts`                                            |
| `computeChecksum()`                                                                                                                                                                                                                            | `src/lib/checksum.ts`                                                  |
| `parseTriggerFromFilename()` / `formatBackupDate()` / `isAbsoluteDirectoryPath()` / `isSameDirectory()`                                                                                                                                                                                                                   | `src/features/backup/utils.ts`                                         |
| `countWords()` / `classifyTransaction()`                                                                                                                                                                                                       | `src/features/metrics/word-count.ts` / `classifier.ts`                 |
| `ensureMetricsSchema()` / `insertEvents()`                                                                                                                                                                                                     | `src/features/metrics/events-repo.ts`                                  |
| `metricsService`                                                                                                                                                                                                                               | `src/lib/metrics/MetricsService.ts`                                    |
| `useNoteStore` / `saveCollapsedHeadings`                                                                                                                                                                                                       | `src/features/notes/store.ts`                                          |
| `CollapsibleHeading` / `collapsibleHeadingPluginKey`                                                                                                                                                                                           | `src/components/editor/extensions/CollapsibleHeading.ts`               |
| `SceneBreakDescriptor` / scene-break attribute helpers                                                                                                                                                                                         | `src/components/editor/extensions/scene-break-utils.ts`                |
| `isTutorialLibraryActive()` / `isTutorialRunInProgress()` / `assertWritableId()` / `trackAuthorLibraryWork()` (Tutorial Library switch; background jobs and write paths honor it)                                                                                     | `src/features/tutorial/library-switch.ts`                              |
| `getAuthorDatabase()` / `initializeSchema(adapter)` (the author's database regardless of the switch; schema on any adapter)                                                                                                                  | `src/lib/db/index.ts`                                                  |
| `createMemoryDatabase()` / `MemoryDatabaseAdapter` (in-memory sql.js Library with the bundled wasm; also backs `createTestDatabase()`)                                                                                                         | `src/lib/db/memory-database.ts`                                        |
| `requestTutorial()` / `startTutorial()` / `exitTutorial()` / `decideTutorialOffer()` / `useTutorialStore` (Tutorial runs and device-local state)                                                                                             | `src/features/tutorial/`                                               |
| `runBetweenSyncRuns(task)` (runs a task with no sync run in flight; the Tutorial switch uses it)                                                                                                                                             | `src/features/sync/sync-engine.ts`                                     |
| `hasLaunchAutoSyncSettled()` / `onLaunchAutoSyncSettled()` (whether this launch's Auto Sync is behind us)                                                                                                                                     | `src/features/sync/auto-sync.ts`                                       |
| `toast.info()` (text-only hint toast)                                                                                                                                                                                                        | `src/components/ui/Toast.tsx`                                          |
| `useModalScope(isOpen)` (LIFO modal ID registration/unregistration)                                                                                                                                                                            | `src/hooks/useModalScope.ts`                                           |
| `useRestoreFocus(isOpen)` (returns focus to the opener after an overlay closes; call it after `useModalOverlay`, whose `inert` cleanup must run first) | `src/hooks/useRestoreFocus.ts` |

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
- **Panel layout responds to its container, not the viewport**: content sits beside a resizable sidebar, so a viewport breakpoint (`md:`) does not describe the space a panel actually has. Mark the wrapper `@container` and use container variants (`@md:`, `@3xl:`) for anything laid out inside the main content area — see the notes filter panel in `src/pages/NotesGallery.tsx`. Viewport breakpoints stay correct for the outermost page shell
- **Touch compatibility**: No hover-only controls (section 2, item 7). Use `pointer-coarse:` for touch-only visibility and larger touch targets, never a viewport breakpoint; desktop hover affordances stay as they are
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
9. **Version restore and version sync are safe**: `restoreVersion` lands pending editor saves first (a failed save rejects before anything changes), creates a `pre-restore` version before applying the snapshot, bumps `updated_at` to now, and emits a local content Change through the shared Book write path; `syncVersions` verifies checksums before inserting pulled blobs; pure-union sync with no duplicates.
10. **Unsaved editor text is never dropped silently**: every sync run flushes open editors before its pre-sync backup or first read, and a failed save stops the run with a Sync Log error; a failed editor save shows Save Status "Not saved" and is retried on the next edit, Flush, or unmount. Test through `NoteEditor.dataSafety.test.tsx` and `BookEditor.dataSafety.test.tsx`.

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
3. **New shortcuts** are tested through their `useShortcuts` binding: they fire when expected, are suppressed in typing targets (`isTypingTarget()` in `src/lib/keyboard.ts`), and the screen's test asserts their id is bound (`useBoundShortcutStore`).

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

- **Create new UI primitives** without checking `src/components/ui/` first — `Button`, `Checkbox`, `Modal`, `Input`, `Select`, `Combobox`, `Switch` already exist
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
- **Hide controls until hover** — touch screens never hover; see section 2, item 7
- **Prove keyboard support with attribute assertions** — tests must press keys via `user-event` and assert behavior, not check `tabIndex`/`aria-*` values (see section 6 test gate)

### Known Footguns

- **Sync write failures**: `client.ts` adds object kind/key, create/update operation, HTTP status, and validation codes to rejected writes; preserve the original status/data for duplicate detection. Test the failure through `useSyncStore` and assert an error log entry after the safety backup, not only `syncError`. A generic "Failed to create record" does not establish a duplicate: capture the validation codes before changing retry or overwrite behavior. Never log note content, auth tokens, or raw validation data.
- **Soft-deleted remote rows**: `listObjects` hides `deleted = true` rows, but they keep the unique `(user, app_name, kind, key)` identity. A local book/note with no live remote row must be checked against `listRemoteDeletedBooks()`/`listRemoteDeletedNotes()` before it is treated as local-only; creating it returns `validation_not_unique`. `resolveRemoteDeletion()` in `entity-sync.ts` owns the rules: unedited since the base → deletion review (`deletedRemotely: true`), edited → conflict with `remoteDeleted: true` (push updates the deleted row, pull removes locally). Local removal goes through `removeLocalBook()`/`removeLocalNote()` in `serializer.ts`, which record no tombstone and delete dependent rows explicitly because no adapter enables SQLite's `foreign_keys` pragma.
- **Backup dump coverage**: A Backup is whatever `SQL_EXPORT_TABLES` (`src/lib/db/sql-export-format.ts`) lists; restore (`replaceRestoreData` in `backup-service.ts`) deletes its own table list. A table restore deletes but the dump omits is wiped on every restore: Canvases were, from v0.4.14 through v0.7.1. When a table joins the dump, gate its delete on that table's section header (see `CANVASES_SECTION_TITLE`) so older Backups keep the device's rows. Test through `src/test/integration/backup-restore-canvases.test.ts`, which uses the real exporter; `createTestDatabase().exportData()` now calls `exportSqlDump` too, so never hand-write a dump in test helpers.
- **Editor latency**: Keep toolbar props stable across parent statistics updates. Toolbar controls subscribe to their own editor state; history availability should update history controls only. Share formatting snapshots through `getEditorToolbarState()` because visible and measurement groups mount separately. Build command helpers inside effects/selectors, not effect dependency arrays. Nothing whose cost grows with chapter length may run per keystroke: `Editor.tsx` coalesces `getHTML()` and word counting into one job per typing burst (`EMIT_COALESCE_MS`), so read the live document through the editor instance at save/export time rather than trusting a pushed snapshot. Verify changes with `EditorToolbarSubscriptions.test.tsx`, `editor-toolbar-state.test.ts`, `Editor.test.tsx`, and Android input measurements.
- **Filesystem scope grants**: the fs scope is the desktop webview's only write boundary. A Rust command must never widen it from a path the webview sends without native UI the author answers (folder picker or a confirmation worded in Rust); see ADR 0010 and `src-tauri/src/backup.rs`. Do not add `tauri-plugin-persisted-scope`: it keeps every picked file in scope forever
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

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues on M4ss1ck/maibuk, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` plus `docs/adr/`. See `docs/agents/domain.md`.

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
