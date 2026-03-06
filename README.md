# Maibuk

A cross-platform writing app for authors. Built with Tauri, React, and TypeScript.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Version](https://img.shields.io/badge/version-0.1.4-green.svg)

## Features

- 📝 **Rich Text Editor** - Full-featured editor with formatting options powered by TipTap
- 📚 **Book & Chapter Management** - Organize your writing into books and chapters
- 🎨 **Cover Designer** - Create custom book covers with an integrated canvas editor
- 📖 **EPUB Export** - Export your books to EPUB format
- 📄 **PDF Export** - Generate PDF versions of your work
- 🌙 **Dark/Light Theme** - Toggle between themes for comfortable writing
- 💾 **Auto-save** - Never lose your work with automatic saving
- 🖼️ **Image Support** - Insert and manage images in your documents
- 🔗 **Link Management** - Add and edit hyperlinks
- 📊 **Tables** - Create and edit tables in your documents
- 🔍 **Find & Replace** - Search and replace text across your document

## Tech Stack

- **Frontend**: React + TypeScript + Vite
- **Backend**: Tauri (Rust)
- **Editor**: TipTap
- **Database**: SQLite (via Drizzle ORM)
- **UI**: Tailwind CSS + Headless UI
- **Canvas**: Fabric.js (for cover design)

## Installation

### From Source

#### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher)
- [pnpm](https://pnpm.io/)
- [Rust](https://www.rust-lang.org/tools/install)
- [Tauri Prerequisites](https://tauri.app/start/prerequisites/)

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

## Testing (TDD)

This project now uses **Vitest + Testing Library** and follows a **test-driven development workflow**:

1. Write a failing test first
2. Implement the smallest change to make it pass
3. Refactor while keeping tests green

Commands:

```bash
# Watch mode (local TDD loop)
pnpm test

# Single run (CI/release)
pnpm test:run

# Coverage report
pnpm test:coverage
```

Test organization (to keep features uncluttered):

- Unit tests: `src/test/unit/**/*.test.ts`
- Integration tests: `src/test/integration/**/*.test.ts`

CI and release pipelines enforce coverage thresholds before build/release jobs.

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

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Author

**M4ss1ck** - [massick.dev](https://massick.dev)
