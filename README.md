# Maibuk

A cross-platform writing app for authors. Built with Tauri, React, and TypeScript.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Release](https://img.shields.io/github/v/release/M4ss1ck/maibuk)

![Maibuk launch film: typing in the Book Editor, then Notes, Canvas, Cover Designer, Version history, Dictation, accent colors and themes, ending on the Maibuk logo](https://github.com/user-attachments/assets/09098692-9a1f-40d5-b6da-278b21f8f430)

## Highlights

- **Rich text writing** with Book and Chapter management, auto-save, and Focus Mode
- **Notes and Canvas** for organizing the writing around your Books
- **Cover Designer** with Templates and Size Presets
- **EPUB, PDF, Markdown, and image export**
- **Version history and Backups**
- **Encrypted Sync** between your devices
- **Dictation and Voice Commands**
- **Command Palette and Custom Shortcuts**

<details>
<summary>Full feature list</summary>

### Writing

- Rich text formatting, tables, links, images, and code blocks
- Book and Chapter management
- Book Status, archiving, and Target Word Count
- Chapter Types and Chapter Status
- Auto-save and Save Status
- Find and replace
- Focus Mode
- Outline and collapsible headings
- Scene Breaks and Footnotes
- Spell Check, Custom Dictionary, and Word Lookup
- Symbols, emoji, and Text Case
- Paste Cleanup and Markdown paste
- HTML view
- Editor zoom, width, and page padding
- Reading Position

### Notes and Canvas

- Book Notes and Unfiled Notes
- Tags, pinning, search, and filtering
- Internal Links and Backlinks
- Ephemeral
- Canvas with Text Nodes, Note References, Connections, and Drawings

### Covers, import, and export

- Cover Designer with Templates, Size Presets, and layers
- EPUB, Markdown, and plain-text Import
- EPUB Compatibility Report
- EPUB and PDF Book Export
- Markdown, PDF, and image Export for Chapters and Notes
- PNG, JPG, and PDF Cover Export

### History, Backups, and Sync

- Named Versions and automatic Checkpoints
- Version Compare and Restore
- Manual and automatic Backups
- Backup retention and Restore
- Database Files and Reset Library
- Encrypted Sync and Auto Sync
- Sync Scope and Sync Direction
- Conflict resolution and Deletion Review
- Sync Log

### Dictation

- English and Spanish Dictation Models
- Spoken Punctuation
- Voice Commands and Click by Name
- Dictation Vocabulary
- Phrase Recording

### Navigation and customization

- Command Palette
- Custom Shortcuts and Shortcut Files
- Single-key Shortcuts switch
- Light, dark, and system themes
- Custom accent color
- Editor fonts and toolbar customization
- English and Spanish interface
- Tutorial
- Writing Metrics and Streaks

</details>

### Dictation shortcuts and settings

Dictation is available in the Linux desktop app and compatible web browsers.
Web Dictation requires microphone access and cross-origin isolation; Safari/WebKit
is currently unsupported. Native Windows and Android Dictation are not available.

In Settings → Dictation, download a Dictation Model for English or Spanish.
Start or stop Dictation with **Ctrl+Shift+Space** (**⌘+Shift+Space** on Mac);
**Escape** stops it while writing. The floating language picker shows `auto`,
`en`, or `es`; Auto follows the editor's Spell Check language, or the app
language in a plain text field.

**Cycle Dictation language** has no Default Shortcut. Assign one in Settings →
Customize shortcuts. It cycles Auto → downloaded languages (English, Spanish)
→ Auto and also changes a running Dictation Session.

Turn **Dictation** off in Settings → Dictation to stop the session, hide the bar,
and disable its toggle and cycle Commands. This choice stays on this device.
Downloaded models remain available to manage while Dictation is off.

## Tech Stack

- **Frontend**: React + TypeScript + Vite
- **Native shell**: Tauri (Rust)
- **Editors**: TipTap (rich text), CodeMirror (HTML view)
- **Storage**: SQLite (Tauri SQL plugin), sql.js (web), Drizzle ORM schema
- **UI**: Tailwind CSS + React Aria
- **State**: Zustand
- **Localization**: i18next + react-i18next
- **Canvas**: React Flow (`@xyflow/react`)
- **Cover Designer**: Fabric.js
- **Sync client**: PocketBase SDK
- **Dictation**: Moonshine (vendored native and WebAssembly runtimes)
- **Quality tools**: Vitest + Testing Library, Playwright, Biome

## Installation

### From Source

#### Prerequisites

- [Node.js](https://nodejs.org/) 22.13 or higher
- [pnpm](https://pnpm.io/) 11.8.0, as pinned in `package.json`

For native development, also install:

- [Rust](https://www.rust-lang.org/tools/install)
- [Tauri platform prerequisites](https://tauri.app/start/prerequisites/)

Web-only development needs Node.js and pnpm; the native toolchain and Linux
system libraries below are not required.

##### Linux system libraries (Debian / Ubuntu / Linux Mint)

Tauri's Rust backend links against the system GTK/WebKit libraries. On a fresh
machine these are not installed, and `pnpm tauri dev` fails while building the
`glib-sys` / `gobject-sys` / `gio-sys` crates with errors like:

```
The system library `gio-2.0` required by crate `gio-sys` was not found.
The file `gio-2.0.pc` needs to be installed and the PKG_CONFIG_PATH
environment variable must contain its parent directory.
```

Install the required development packages (these provide the `glib`, `gobject`,
`gio`, `gtk`, and ALSA (Dictation's microphone capture) dev files with the missing
`pkg-config` `.pc` files):

```bash
sudo apt update
sudo apt install \
  libwebkit2gtk-4.1-dev \
  build-essential \
  curl \
  wget \
  file \
  libxdo-dev \
  libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  libasound2-dev \
  patchelf
```

`patchelf` is used for Linux packaging. Then verify `pkg-config` can find the
libraries:

```bash
pkg-config --exists webkit2gtk-4.1 && echo "OK"
```

For other distributions (Fedora, Arch, openSUSE), see the
[Tauri prerequisites guide](https://tauri.app/start/prerequisites/#linux).

#### Development

Install JavaScript dependencies:

```bash
pnpm install
```

For the native app, fetch the Dictation runtimes before starting Tauri:

```bash
pnpm fetch:dictation
pnpm tauri dev
```

For web-only development:

```bash
pnpm fetch:dictation --web
pnpm dev:web
```

The web app runs at `http://localhost:5173`; Tauri uses port 1420.

#### Building

Fetch the Dictation runtimes with `pnpm fetch:dictation` before a native build.
Each target also needs its platform toolchain:

- **Linux**: the system libraries above, plus `patchelf` for packaging.
- **Windows cross-compilation from Linux**: the `x86_64-pc-windows-gnu` Rust
  target, MinGW, NSIS, LLVM, Clang, and lld. The
  [release workflow](.github/workflows/release.yml) records the package setup.
- **Android**: a JDK, Android SDK and NDK, OpenSSL, the Android Rust targets, and
  `JAVA_HOME`, `ANDROID_HOME`, and `NDK_HOME` configured. Follow the
  [Tauri prerequisites](https://tauri.app/start/prerequisites/) for Android.
  The release workflow uses JDK 21. The build script creates signing material
  under `~/.config/maibuk/android-signing`; keep it to sign future updates.

```bash
# Linux bundles
pnpm build:linux

# Windows bundles (cross-compile from Linux)
pnpm build:windows

# Signed Android APKs
pnpm build:android

# Static web build (fetches the web Dictation runtime automatically)
pnpm build:web
```

## Embed Mode (iframe)

`/embed` is a standalone TipTap editor playground: a chrome-less page for iframe
embedding on external sites. It shares nothing stateful with the rest of the app
(no books, no sync, no persistence). Reloading the iframe resets the editor.

- URL: `/embed`
- Optional query param: `theme=light` / `theme=dark` / `theme=system` (default
  `system`). The theme is applied to the iframe document only; it does not write
  to the app's persisted theme.

### Frame/CSP headers (Cloudflare Pages)

The production `frame-ancestors` policy lives in `public/_headers`:

```txt
/embed
  Content-Security-Policy: frame-ancestors 'self' https://www.massick.dev
```

Notes:

- Cloudflare Pages requires header lines to be indented under the path.
- Do not send `X-Frame-Options` on `/embed`; it conflicts with `frame-ancestors`.
- `public/_headers` is applied by Cloudflare Pages only. `pnpm dev:web` does not
  enforce CSP, so local iframe verification succeeds from any origin.

### Local iframe verification

1. Start the web app: `pnpm dev:web`
2. Open an HTML page containing:

```html
<!doctype html>
<iframe
  src="http://localhost:5173/embed"
  style="width: 800px; height: 450px; border: 1px solid #ccc;"
  sandbox="allow-scripts allow-same-origin"
  loading="lazy"
></iframe>
```

## Testing

The project uses Vitest + Testing Library and follows a test-driven workflow:

1. Write a failing test.
2. Implement the smallest change to make it pass.
3. Refactor while keeping tests green.

```bash
# Watch mode (local TDD loop)
pnpm test

# Single run (CI/release)
pnpm test:run

# Coverage report
pnpm test:coverage
```

Test organization:

- Unit tests: `src/test/unit/**/*.test.{ts,tsx}`
- Integration tests: `src/test/integration/**/*.test.{ts,tsx}`
- End-to-end tests: Playwright workflows in `e2e/specs/`

### Quality checks

```bash
pnpm lint
pnpm typecheck
pnpm test:release
```

Biome handles linting and formatting. TypeScript checks test files too; Vitest
alone does not typecheck them. `pnpm test:release` tests the changelog generator
offline.

### End-to-end tests

The local Playwright suite runs keyboard workflows in Chromium and WebKit,
with separate phone and voice projects. The Sync lane runs against a local
test server. See the
[E2E guide](e2e/README.md) for browser installation, test assets, running each
lane, and PR screenshots.

E2E tests run separately from Vitest, builds, and CI. CI enforces coverage in a
separate job while lint, typecheck, and the web build run independently. Release
builds wait for the release quality gate, including coverage.

## Releasing

Releases are cut locally with `scripts/release.sh` and built on GitHub Actions.
The script runs from your machine. Choose an unreleased semantic version
(`MAJOR.MINOR.PATCH`) and replace the example value below before releasing:

```bash
RELEASE_VERSION=0.10.1

# Preview what would happen (no changes made)
./scripts/release.sh "$RELEASE_VERSION" --dry-run

# Cut the chosen release
./scripts/release.sh "$RELEASE_VERSION"
```

What it does:

1. Ensures you are on a `release/v<version>` branch, creating it if needed.
2. Bumps the version in `package.json`, `src-tauri/Cargo.toml`,
   `src-tauri/Cargo.lock` and `src-tauri/tauri.conf.json`.
3. Generates a `CHANGELOG.md` section for the commits since the last tag.
4. Commits the bump + changelog, creates the `v<version>` tag, and (after a
   confirmation) pushes the branch and the tag. Pushing the tag triggers the
   release workflow, which reads the latest `CHANGELOG.md` section into the
   GitHub release notes.

The workflow builds Linux, Windows, Android and Arch packages in parallel. Each
build attaches its binaries to a draft release; once all four have finished, the
`publish` job flips that draft to a public release and marks it latest. There is
no manual publish step.

If a build fails, `publish` is skipped and the release stays a draft, so a
half-empty release is never made public. Fix the build and re-run the workflow,
or publish the draft by hand if the missing platform can wait.

After the build finishes, open a PR from the `release/v<version>` branch into
`main` and merge it.

### AI-assisted changelog (optional)

The changelog can be written by an AI model. This is entirely optional — with no
configuration the script falls back to a grouped list of commit messages and
never errors out. Configure it via a local `.env` file (git-ignored; copy
`.env.example` to get started):

Both providers are OpenAI-compatible HTTP APIs and require an API key, plus
`curl` and `jq` installed locally.

| Variable                | Purpose                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| `CHANGELOG_AI_PROVIDER` | `opencode`, `openai`, or empty to disable AI                                             |
| `CHANGELOG_AI_MODEL`    | Model id. opencode: required (e.g. `deepseek-v4-pro`); openai: defaults to `gpt-4o-mini` |
| `OPENCODE_API_KEY`      | Required for `opencode` (from [opencode.ai/auth](https://opencode.ai/auth))              |
| `OPENCODE_BASE_URL`     | Optional; defaults to `https://opencode.ai/zen/go/v1`                                    |
| `OPENAI_API_KEY`        | Required for `openai`                                                                    |
| `OPENAI_BASE_URL`       | Optional; any OpenAI-compatible endpoint (defaults to `https://api.openai.com/v1`)       |

- **opencode** targets [opencode Go](https://opencode.ai/docs/go/), an
  OpenAI-compatible API at `https://opencode.ai/zen/go/v1`.
- **openai** targets OpenAI or any other OpenAI-compatible `/chat/completions`
  endpoint via `OPENAI_BASE_URL` (OpenRouter, Groq, local, ...).

Use `--dry-run` to preview the generated changelog before committing anything.

If the provider rejects the request the script prints the HTTP status and the
provider's error body, then falls back to the grouped commit list — the release
never fails because of the changelog. Watch for a `[WARNING]` line: a silent
fallback is what made a provider-side API change (opencode Go starting to
require an `x-opencode-session` header) go unnoticed for four releases.

Run `pnpm test:release` to exercise the generator offline; it stubs the network
and asserts the provider request shape, so a change like that one fails a test
instead of quietly degrading the changelog.

## Project Structure

```text
maibuk/
├── src/                    # Shared React frontend
│   ├── components/         # UI primitives and feature-specific components
│   ├── features/           # Books, Notes, Canvas, Sync, Dictation, and other modules
│   ├── hooks/              # Shared React hooks
│   ├── lib/
│   │   ├── db/             # Database initialization and schema
│   │   └── platform/       # Tauri and web adapters
│   ├── locales/            # English and Spanish strings
│   ├── pages/              # Route-level components
│   └── test/               # Unit and integration tests
├── src-tauri/              # Native Rust backend and Android project
├── e2e/                    # Playwright specs, fixtures, and coverage matrix
├── docs/adr/               # Architecture decisions
├── public/                 # Static assets and hosting headers
├── scripts/                # Build, release, runtime-fetch, and test tooling
└── vendor/                 # Downloaded runtimes and test assets (not committed)
```

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/)
  - [Tauri Extension](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode)
  - [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
  - [Biome](https://marketplace.visualstudio.com/items?itemName=biomejs.biome)
  - [Tailwind CSS IntelliSense](https://marketplace.visualstudio.com/items?itemName=bradlc.vscode-tailwindcss)
  - [Vitest](https://marketplace.visualstudio.com/items?itemName=vitest.explorer) (optional)
  - [Playwright Test](https://marketplace.visualstudio.com/items?itemName=ms-playwright.playwright) (optional)

## Accessibility

Maibuk is built to be operated entirely from the keyboard. Automated accessibility
checks cover the application's core surfaces; screen-reader compatibility also
requires manual testing. This is not a claim of full WCAG conformance.

**Platform targets**

- **Web build** and **Windows (Tauri / WebView2)** with **NVDA** are the primary
  screen-reader targets. Platform compatibility requires manual testing.
- **Linux (WebKitGTK)** with **Orca** is treated as observational only; its support
  status is not yet verified and no compatibility is claimed until a full session
  passes.

**Automated coverage**

Keyboard behavior and accessibility checks cover:

- dialogs (focus trap, Escape, and focus restoration);
- primary navigation / sidebar;
- the Book, Notes, and Canvas Galleries;
- the chapter list;
- editor structural navigation (pane cycling, Escape behavior, Tab indentation);
- route-change announcements; and
- ordinary form controls and buttons.

**Limits**

Semantic access to the _content_ of visual canvas surfaces is out of scope:

- Canvas nodes and Connections (React Flow); and
- the cover designer artwork itself (Fabric.js).

The headings, toolbars, and panels surrounding these surfaces have keyboard paths
and accessibility checks. The visual graph/artwork content lacks an alternative
representation.

Automated checks (axe) run per route as a safety net, but automated status alone is
not treated as evidence of screen-reader support — behavioral keyboard tests and
manual assistive-technology sessions are the authority.

## Troubleshooting sync uploads

When an upload fails, the sync panel shows the error below the last synced time
and records it in the sync log. Rejected object writes include the operation
(`objects.create` or `objects.update`), object kind and ID, HTTP status when
available, and server validation codes. Include that full error when reporting
a sync problem; do not include passwords, encryption passphrases, or note text.

The sync panel opens preselecting the scope for where you opened it: Notes
from a note, Books from a book, Canvases from an open canvas, and All from
Settings. Opening the panel never starts a sync on its own; changing the scope
applies to that opening only, and reopening resets to the contextual default.

### How local edits reach sync and the screen

Every Book, Chapter, Note, and Canvas write goes through one narrow write path
per entity (`src/features/books/write.ts`, `src/features/chapters/write.ts`,
`src/features/notes/write.ts`, `src/features/canvas/write.ts`): normalize,
persist, return the stored row, then emit a Change on the single Change Feed
(`src/features/sync/change-feed.ts`) shaped
`{ entity: "book" | "note" | "canvas", id, origin: "local" | "remote", kind: "content" | "metadata" }`.
Chapter edits are reported under their containing Book's id.

- Auto Sync listens to local Changes of both kinds; remote Changes never
  schedule it.
- Pulled snapshots apply through the same write paths with a remote origin;
  the view-refresh subscriber (`src/features/sync/view-refresh.ts`) re-reads
  the affected stores in place, so open editors keep their mounts and
  selection. Version Restore applies with a local origin and refreshes the
  views explicitly.
- The kind only decides whether Last Edited (`content_updated_at`) moves:
  content and title edits move it, pin/order/status moves do not.

The Notes scope processes all local notes, so a failed upload may belong to a
different note from the one currently open. The reported object ID identifies
which write failed. A failed sync does not advance the last synced time.

### Items deleted on another device

Deleting a Book, Note, or Canvas marks it deleted on the server; the server
keeps the record under the same ID. When another device still has that item, sync never
uploads it as a new item (the server would reject that with
`validation_not_unique`). Instead:

- **Not edited here since the last sync:** the item appears under "Deleted on
  another device" in the sync panel. Nothing is removed until you confirm;
  confirming takes a safety backup and removes the local copy.
- **Edited here since the last sync:** sync asks. "Keep & Push" uploads this
  copy and restores the item on the server; "Delete Here" removes the local copy.
  Automatic sync leaves the choice for a manual sync.
- **Push only** skips the item with a warning in the sync log; run a two-way or
  pull sync to review it. **Pull only** always lists it for confirmation.

## Contributing

Contributions are welcome. Please open a pull request.

Read the [domain glossary](GLOSSARY.md), [architecture decisions](docs/adr/), and
[codebase guide](AGENTS.md) before making changes, and write and review code against the
[coding standards](CODING_STANDARDS.md). The [E2E guide](e2e/README.md)
covers workflow tests and screenshots for UI changes.

**Keyboard & accessibility are completion requirements**: any new or modified UI must be fully operable by keyboard and backed by behavioral keyboard tests. See "Keyboard and accessibility" and its test gate in [CODING_STANDARDS.md](CODING_STANDARDS.md) — a feature that can't be driven without a mouse is not done.

## License

Licensed under the MIT License. See [LICENSE](LICENSE) for details.

## Author

**M4ss1ck** - [massick.dev](https://massick.dev)
