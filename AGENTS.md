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
| Cover Designer   | Fabric.js 7                                                 |
| Database         | SQLite (Tauri plugin) / sql.js (web) via Drizzle ORM schema |
| i18n             | i18next + react-i18next (English, Spanish)                  |
| Icons            | Lucide React + custom SVGs in `src/components/icons/`       |
| Accessible UI    | Headless UI 2.2                                             |
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
| `/book/:bookId`       | `BookEditor`    | Full-page (no sidebar)    |
| `/book/:bookId/cover` | `CoverDesigner` | Full-page (no sidebar)    |

---

## 2. Development Principles

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
│   ├── sync/            # Sync status button, auth/passphrase dialogs, sync panel
│   ├── project/         # Book card, new book dialog
│   ├── book/            # Book settings dialog
│   └── icons/           # Custom SVG icon components
├── features/            # Feature modules (business logic + state)
│   ├── books/           # store.ts, types.ts
│   ├── chapters/        # store.ts, types.ts
│   ├── covers/          # types.ts
│   ├── export/          # generators, sanitizers, styles, types
│   ├── settings/        # store.ts, types.ts, AppSettingsProvider.tsx
│   ├── sync/            # store.ts, types.ts, crypto.ts, serializer.ts, client.ts, sync-engine.ts
│   ├── theme/           # store.ts
│   └── version/         # useVersionCheck.ts
├── hooks/               # Shared React hooks
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
2. Third-party libraries (`zustand`, `react-router-dom`, `@tiptap/*`, `@headlessui/react`, `lucide-react`)
3. Internal absolute paths — features, lib, hooks
4. Relative paths — sibling components, local types
5. CSS imports (only in `main.tsx`)

There are **no path aliases** configured. All imports use relative paths (`../../lib/db`, `./types`).

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

**Dialog/Modal pattern** (uses Headless UI):

```tsx
<Dialog open={isOpen} onClose={onClose}>
  <DialogBackdrop />
  <DialogPanel>...</DialogPanel>
</Dialog>
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

| What                                                               | Where                                   |
| ------------------------------------------------------------------ | --------------------------------------- |
| `useAutoSave(callback, delay)`                                     | `src/hooks/useAutoSave.ts`              |
| `useDebouncedCallback(callback, delay)`                            | `src/hooks/useAutoSave.ts`              |
| `getDatabase()`                                                    | `src/lib/db/index.ts`                   |
| `exportDatabase()` / `importDatabase()` / `resetDatabase()`        | `src/lib/db/index.ts`                   |
| `createDatabase()` / `getFileSystem()` / `getDialog()` / `getOS()` | `src/lib/platform/index.ts`             |
| `IS_WEB` / `IS_TAURI`                                              | `src/lib/platform/index.ts`             |
| `processChapterHtml()` / `sanitizeHtmlForEpub()`                   | `src/features/export/html-sanitizer.ts` |
| `generateEpub()` / `generatePdfHtml()`                             | `src/features/export/`                  |
| `APP_VERSION` / `DOWNLOAD_PAGE`                                    | `src/constants.ts`                      |
| `detectSystemLocale()`                                             | `src/i18n.ts`                           |
| Font/size/language option arrays                                   | `src/features/settings/types.ts`        |
| `encrypt()` / `decrypt()` / `computeChecksum()`                    | `src/features/sync/crypto.ts`           |
| `serializeBook()` / `applyBookSnapshot()`                          | `src/features/sync/serializer.ts`       |
| `syncBook()` / `syncAllBooks()`                                    | `src/features/sync/sync-engine.ts`      |
| PocketBase client (`initClient`, `login`, etc.)                    | `src/features/sync/client.ts`           |
| `useSyncStore`                                                     | `src/features/sync/store.ts`            |
| `toast.success()` / `ToastViewport`                                | `src/components/ui/Toast.tsx`           |

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

---

## 6. Testing & Quality

### Current State

Testing is configured with **Vitest + Testing Library + jsdom**.

- Test files: `src/**/*.test.ts` and `src/**/*.test.tsx`
- Test setup: `src/test/setup.ts`
- Commands:
  - `pnpm test` (watch mode)
  - `pnpm test:run` (single run)
  - `pnpm test:coverage` (coverage report)

Use TDD by default:

1. Write a failing test
2. Implement the minimum code to pass
3. Refactor safely with tests green

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
- **Add path aliases** — the project uses relative imports consistently
- **Use `get()` inside Zustand stores** — existing stores only use `set()`

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
