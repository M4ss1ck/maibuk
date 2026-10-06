# AGENTS.md: Maibuk guide for AI agents

## Project overview

**Maibuk** is a cross-platform writing application for book authors. One React frontend runs as a native desktop and Android app (Tauri 2, Rust) and as a web app (sql.js and browser APIs).

Stack: React 19 and TypeScript 5.8, Vite 7, Tailwind CSS 4, Zustand 5, React Router 7, TipTap 3 (editor), React Aria (accessible UI), Fabric.js 7 (Cover Designer), SQLite through the Tauri plugin or sql.js with a Drizzle schema, i18next (English and Spanish), pnpm 10.

Entry points: `src/main.tsx` (bootstrap), `src/App.tsx` (routes), `src-tauri/src/lib.rs` (Rust backend).

## Read before you work

This file holds only what every task needs. The rest sits behind these pointers; read a target when its condition holds, before writing code.

| When                                                                                                                                       | Read                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Before naming anything (identifiers, UI copy, test names, commits) or proposing a restructure                                             | `CONTEXT.md`, `docs/adr/`, then `CODING_STANDARDS.md` "Domain language"                  |
| Before writing a hook, utility, helper, component, store, or feature module, or when asking "is there already a helper for X?"            | `docs/agents/utilities-and-components.md`                                                |
| Before UI, styling, or layout work                                                                                                         | `docs/agents/design.md`                                                                  |
| Before building or changing interactive UI, an action, a shortcut, or a menu entry                                                         | `CODING_STANDARDS.md` "Keyboard and accessibility"                                       |
| Before writing tests                                                                                                                       | `CODING_STANDARDS.md` "Testing"                                                          |
| Before touching Book, Chapter, Note, or Canvas writes, a background job, a store that caches Library rows, or the Tutorial                 | `CODING_STANDARDS.md` "Area rules"                                                       |
| Before touching sync, backups, Checkpoints, the database, schema, editor performance, platform code, or Tauri capabilities                 | `CODING_STANDARDS.md` "Known footguns"                                                   |
| Before calling work done, and when reviewing                                                                                               | `CODING_STANDARDS.md` in full (`/code-review` reads it)                                  |
| Before picking up, filing, or labelling an issue                                                                                           | `docs/agents/issue-tracker.md`, `docs/agents/triage-labels.md`                           |
| Before writing or running an E2E spec                                                                                                      | `e2e/README.md`, then `CODING_STANDARDS.md` "E2E"                                        |

## Done means

Each line is a completion requirement. The rule in full is in `CODING_STANDARDS.md` under the name in brackets.

- **TDD loop**: write a failing test, make it pass with the least code, refactor while green. Every behavior change ships its test in the same change. [TDD workflow]
- **Feature-critical gate**: a change to `src/features/backup/`, `sync/`, or `versions/`, a platform `backup.ts`, `src/lib/db/sql-parser.ts`, or the UI that triggers their destructive paths is not done until its spec-critical paths are tested. [Feature-critical test gate]
- **Keyboard and accessibility**: interactive UI is operable by keyboard alone, manages focus through React Aria, has localized labels, registers its actions as Commands, is reachable by touch, and ships before and after screenshots, light and dark, in the PR. [Keyboard and accessibility]
- **Keyboard test gate**: those paths are proven by `user-event` key presses that assert behavior, never by checking attributes. [Keyboard and accessibility test gate]
- **E2E suite**: new interactive UI has a row in `e2e/coverage-matrix.ts` and a spec tagged `@wf:<row-id>` that passes locally. Playwright never runs in CI. [E2E]
- **Strings**: every user-visible string goes through i18n, with keys in both `src/locales/en.json` and `src/locales/es.json`. [i18n]
- **Gates**: `pnpm lint` and `pnpm typecheck` pass. Vitest does not check types. [Linting and formatting]

## Where new files go

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

## Commands

```bash
pnpm dev              # Tauri dev (Vite + Rust hot reload)
pnpm dev:web          # Web-only dev
pnpm test             # Tests in watch mode (TDD loop)
pnpm test:run         # Tests once
pnpm test:coverage    # Coverage report with thresholds
pnpm typecheck        # tsc over src/, test files included
pnpm lint             # Biome
pnpm test:e2e         # Playwright, local only (e2e/README.md)
pnpm build:web        # Web static build
```

Every other script is in `package.json`; each measurement lane (`bench:*`, `conformance:*`, `screenshots`, `test:e2e:sync`) is documented beside the tool it measures, in `docs/agents/utilities-and-components.md` or `e2e/README.md`.

<!-- headroom:rtk-instructions -->
Prefix shell commands with `rtk` (`rtk git status`, `rtk pnpm test:run`) to cut output tokens; it passes unfiltered commands through unchanged. Prefix each segment of a chain. Run the raw command when debugging; `rtk proxy <cmd>` runs it unfiltered but tracked.
<!-- /headroom:rtk-instructions -->

## Updating AGENTS.md

This file has a 2,000-word budget, checked in CI (`scripts/agents-word-budget.mjs`). Reference material goes behind a pointer, not in here:

- A new shared hook, utility, or reusable UI component gets a row in `docs/agents/utilities-and-components.md`.
- A new coding rule, test rule, or footgun goes in `CODING_STANDARDS.md`.
- A new design token or styling convention goes in `docs/agents/design.md`.
- A new feature module that changes where files go updates "Where new files go" above.

Add a line here only when every task needs it. A new target document gets a row in "Read before you work" that says when to read it.

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues on M4ss1ck/maibuk, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` plus `docs/adr/`. See `docs/agents/domain.md`.
