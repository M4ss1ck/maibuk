# Maibuk

A cross-platform writing app for authors. Built with Tauri, React, and TypeScript.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Release](https://img.shields.io/github/v/release/M4ss1ck/maibuk)

## Features

- **Rich text editor** powered by TipTap, with formatting, tables, links, and images
- **Book and chapter management** to organize your writing
- **Cover designer** with an integrated canvas editor
- **EPUB and PDF export**
- **Dark and light themes**
- **Auto-save**
- **Find and replace**

## Tech Stack

- **Frontend**: React + TypeScript + Vite
- **Backend**: Tauri (Rust)
- **Editor**: TipTap
- **Database**: SQLite (via Drizzle ORM)
- **UI**: Tailwind CSS + Headless UI
- **Canvas**: Fabric.js (cover designer)

## Installation

### From Source

#### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher)
- [pnpm](https://pnpm.io/)
- [Rust](https://www.rust-lang.org/tools/install)
- [Tauri prerequisites](https://tauri.app/start/prerequisites/)

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
`gio`, and `gtk` dev files with the missing `pkg-config` `.pc` files):

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
  librsvg2-dev
```

Then verify `pkg-config` can find the libraries:

```bash
pkg-config --exists webkit2gtk-4.1 && echo "OK"
```

For other distributions (Fedora, Arch, openSUSE), see the
[Tauri prerequisites guide](https://tauri.app/start/prerequisites/#linux).

#### Development

```bash
# Install dependencies
pnpm install

# Run in development mode
pnpm tauri dev

# Run tests in watch mode
pnpm test
```

#### Building

```bash
# Build for Linux
pnpm build:linux

# Build for Windows (cross-compile)
pnpm build:windows

# Build for Android
pnpm build:android

# Build web version
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

- Unit tests: `src/test/unit/**/*.test.ts`
- Integration tests: `src/test/integration/**/*.test.ts`

CI and release pipelines enforce coverage thresholds before build and release jobs.

## Releasing

Releases are cut locally with `scripts/release.sh` and built on GitHub Actions.
The script runs from your machine:

```bash
# Preview what would happen (no changes made)
./scripts/release.sh 0.4.13 --dry-run

# Cut the release
./scripts/release.sh 0.4.13
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

After the build finishes, open a PR from the `release/v<version>` branch into
`main`, merge it, then review and publish the draft release.

### AI-assisted changelog (optional)

The changelog can be written by an AI model. This is entirely optional — with no
configuration the script falls back to a grouped list of commit messages and
never errors out. Configure it via a local `.env` file (git-ignored; copy
`.env.example` to get started):

Both providers are OpenAI-compatible HTTP APIs and require an API key.

| Variable | Purpose |
| --- | --- |
| `CHANGELOG_AI_PROVIDER` | `opencode`, `openai`, or empty to disable AI |
| `CHANGELOG_AI_MODEL` | Model id. opencode: required (e.g. `deepseek-v4-pro`); openai: defaults to `gpt-4o-mini` |
| `OPENCODE_API_KEY` | Required for `opencode` (from [opencode.ai/auth](https://opencode.ai/auth)) |
| `OPENCODE_BASE_URL` | Optional; defaults to `https://opencode.ai/zen/go/v1` |
| `OPENAI_API_KEY` | Required for `openai` |
| `OPENAI_BASE_URL` | Optional; any OpenAI-compatible endpoint (defaults to `https://api.openai.com/v1`) |

- **opencode** targets [opencode Go](https://opencode.ai/docs/go/), an
  OpenAI-compatible API at `https://opencode.ai/zen/go/v1`.
- **openai** targets OpenAI or any other OpenAI-compatible `/chat/completions`
  endpoint via `OPENAI_BASE_URL` (OpenRouter, Groq, local, ...).

Use `--dry-run` to preview the generated changelog before committing anything.

## Project Structure

```
maibuk/
├── src/                    # React frontend source
│   ├── components/         # UI components
│   │   ├── editor/         # Text editor components
│   │   ├── cover-editor/   # Cover designer components
│   │   ├── export/         # Export dialog components
│   │   └── ui/             # Reusable UI components
│   ├── features/           # Feature modules
│   │   ├── books/          # Book management
│   │   ├── chapters/       # Chapter management
│   │   ├── covers/         # Cover design
│   │   ├── export/         # EPUB/PDF generation
│   │   └── settings/       # App settings
│   ├── hooks/              # Custom React hooks
│   ├── lib/                # Utilities and database
│   └── pages/              # Page components
├── src-tauri/              # Tauri/Rust backend
│   └── src/                # Rust source code
├── public/                 # Static assets
└── scripts/                # Build scripts
```

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/)
  - [Tauri Extension](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode)
  - [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
  - [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint)
  - [Tailwind CSS IntelliSense](https://marketplace.visualstudio.com/items?itemName=bradlc.vscode-tailwindcss)

## Contributing

Contributions are welcome. Please open a pull request.

**Keyboard & accessibility are completion requirements**: any new or modified UI must be fully operable by keyboard and backed by behavioral keyboard tests. See the "Keyboard & Accessibility Are Completion Requirements" and "Keyboard & Accessibility Test Gate" sections in [AGENTS.md](AGENTS.md) — a feature that can't be driven without a mouse is not done.

## License

Licensed under the MIT License. See [LICENSE](LICENSE) for details.

## Author

**M4ss1ck** - [massick.dev](https://massick.dev)
