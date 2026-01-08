# Maibuk - Author Writing App Implementation Plan

## Overview

Cross-platform book writing app for Linux, Windows, Android, and Web. Standalone/offline-first with no server required.

## Tech Stack

| Layer        | Technology                      | Justification                                                                       |
| ------------ | ------------------------------- | ----------------------------------------------------------------------------------- |
| Framework    | **Tauri v2**                    | Cross-platform (desktop + Android + web), smaller than Electron, native file access |
| Frontend     | **React**                       | Largest ecosystem, excellent Tiptap integration, familiar DX                        |
| Build        | **Vite**                        | Fast HMR, great Tauri integration                                                   |
| Styling      | **TailwindCSS v4**              | CSS-first config (no JS config file), utility-first                                 |
| Editor       | **Tiptap v2**                   | ProseMirror-based, extensible, headless                                             |
| Cover Editor | **Fabric.js**                   | Canvas with built-in text editing, layer management                                 |
| Database     | **SQLite** via tauri-plugin-sql | Offline-first, local storage                                                        |
| ORM          | **Drizzle ORM**                 | TypeScript-first, lightweight                                                       |
| State        | **Zustand**                     | Simple, no boilerplate, works great with React                                      |
| EPUB         | **epub-gen-memory**             | Browser + Node compatible                                                           |
| PDF          | **printpdf** (Rust)             | Native Tauri backend                                                                |

## Project Structure

```
maibuk/
├── package.json
├── vite.config.ts
├── index.html
├── src/                          # Frontend
│   ├── main.tsx
│   ├── App.tsx
│   ├── components/
│   │   ├── ui/                   # Button, Input, Modal, Sidebar
│   │   ├── editor/               # Tiptap wrapper + extensions
│   │   ├── cover-editor/         # Fabric.js canvas
│   │   ├── project/              # Book/chapter management
│   │   └── export/               # Export dialogs
│   ├── features/
│   │   ├── books/                # store, api, types
│   │   ├── chapters/
│   │   ├── covers/
│   │   └── export/               # epub.ts, pdf.ts
│   ├── pages/
│   │   ├── Home.tsx              # Project dashboard
│   │   ├── BookEditor.tsx        # Main writing view
│   │   ├── CoverDesigner.tsx
│   │   └── Settings.tsx
│   ├── hooks/
│   ├── lib/
│   │   ├── db/                   # Drizzle schema + migrations
│   │   └── tauri/                # FS, dialog wrappers
│   └── styles/
└── src-tauri/                    # Rust backend
    ├── Cargo.toml
    ├── tauri.conf.json
    └── src/
        ├── main.rs
        ├── commands/
        │   ├── export.rs         # PDF generation
        │   └── project.rs
        └── pdf/                  # printpdf renderer
```

## Data Models

### Books

```typescript
interface Book {
  id: string;
  title: string;
  subtitle?: string;
  authorName: string;
  description?: string;
  genre?: string;
  coverImagePath?: string;
  coverData?: FabricCoverData; // Fabric.js JSON
  wordCount: number;
  status: "draft" | "in-progress" | "completed";
  createdAt: Date;
  updatedAt: Date;
}
```

### Chapters

```typescript
interface Chapter {
  id: string;
  bookId: string;
  title: string;
  content: TiptapContent | null; // Tiptap JSON
  order: number;
  chapterType: "chapter" | "prologue" | "epilogue" | "part";
  wordCount: number;
  isIncludedInExport: boolean;
}
```

## Tiptap Extensions Needed

**Standard:**

- StarterKit (bold, italic, headings, lists)
- Typography (smart quotes)
- Image (resizable)
- Table, TableRow, TableCell, TableHeader
- Link, Underline, Highlight, TextAlign
- Placeholder, CharacterCount

**Custom (to build):**

- Footnote (based on tiptap-footnotes)
- SceneBreak (horizontal rule variant)
- PageBreak (for export)
- CommentBlock (author notes, excluded from export)

## Implementation Phases

### Phase 1: Foundation

- [ ] Initialize Tauri v2 + frontend framework + Vite
- [ ] Set up SQLite + Drizzle schema
- [ ] Basic routing (home, editor, settings)
- [ ] Base UI components
- [ ] Book CRUD operations

### Phase 2: Editor Core

- [x] Integrate Tiptap with StarterKit
- [x] Editor toolbar
- [x] Auto-save with debouncing
- [x] Chapter management (add, delete, reorder)
- [x] Word count tracking
- [x] Focus mode (distraction-free)

### Phase 3: Advanced Editor

- [x] Footnotes extension
- [x] Table support
- [x] Image insertion + resizing
- [x] Scene break component
- [x] Find and replace

### Phase 4: Cover Editor

- [ ] Fabric.js canvas integration
- [ ] Cover dimension presets (6x9, 5x8)
- [ ] Text layers with styling
- [ ] Image upload/positioning
- [ ] Template system
- [ ] Export to PNG/JPEG

### Phase 5: EPUB Export

- [ ] Tiptap JSON → clean HTML conversion
- [ ] epub-gen-memory integration
- [ ] Table of contents generation
- [ ] Cover embedding
- [ ] Footnote handling
- [ ] Export progress dialog

### Phase 6: PDF Export

- [ ] Rust PDF renderer (printpdf)
- [ ] Page layout system
- [ ] Chapter headers/footers
- [ ] Page numbering
- [ ] Font embedding

### Phase 7: Polish

- [ ] Keyboard shortcuts
- [ ] Undo/redo history
- [ ] Backup system
- [ ] Writing statistics
- [ ] Dark/light theme
- [ ] Import from DOCX/TXT

### Phase 8: Mobile & Web

- [ ] Android build configuration
- [ ] Touch-optimized UI
- [ ] Responsive layouts
- [ ] Web-specific storage fallback (IndexedDB)

## Key Dependencies

### Frontend (npm)

```
react, react-dom
@tauri-apps/api, @tauri-apps/plugin-sql, @tauri-apps/plugin-fs
@tiptap/react, @tiptap/starter-kit, @tiptap/extension-*
fabric
epub-gen-memory
drizzle-orm
tailwindcss (v4, CSS-first), zustand
```

### Backend (Cargo)

```
tauri, tauri-plugin-sql, tauri-plugin-fs
printpdf
serde, serde_json
uuid, chrono
```

## Key Challenges & Solutions

| Challenge            | Solution                                      |
| -------------------- | --------------------------------------------- |
| Footnotes            | Fork tiptap-footnotes or custom extension     |
| PDF quality          | Custom Rust renderer mapping Tiptap nodes     |
| Large documents      | Load only active chapter, lazy loading        |
| Mobile editing       | Mobile-specific toolbar, gesture support      |
| Cross-platform paths | Tauri path API for platform-agnostic handling |

## UI/UX Principles

- **Minimal distraction** - Clean interface that fades when writing
- **Content-first** - Text is the hero
- **Three-pane layout** - Sidebar | Editor | Inspector (optional)
- **Focus mode** - Hide sidebar, center content
- **Auto-save** - No manual save needed, subtle "Saved" indicator
- **Typography** - Serif for editor (Literata), sans-serif for UI (Inter)

## Sources

- [Tauri v2 Stable Release](https://v2.tauri.app/blog/tauri-20/)
- [Tiptap React Setup](https://tiptap.dev/docs/editor/getting-started/install/react)
- [TenTap for React Native](https://github.com/10play/10tap-editor)
- [epub-gen-memory](https://github.com/cpiber/epub-gen-memory)
- [Offline-First Apps 2025](https://blog.logrocket.com/offline-first-frontend-apps-2025-indexeddb-sqlite/)
