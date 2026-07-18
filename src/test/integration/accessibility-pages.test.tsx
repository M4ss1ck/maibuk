import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Book } from "@/features/books/types";
import type { Note } from "@/features/notes";
import type { Canvas as CanvasType, CanvasDoc } from "@/features/canvas/types";
import { expectNoAxeViolations } from "@/test/support/accessibility";

// ── Shared hoisted mocks ───────────────────────────────────────────────

const txs = vi.hoisted(() => ({
  isMac: false,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key as string,
    i18n: { language: "en" },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@/features/version", () => ({
  useVersionCheck: () => ({ latestVersion: "v99.0.0", isOutdated: false }),
}));

vi.mock("@/lib/platform", () => ({
  IS_WEB: false,
  IS_TAURI: true,
  isMac: () => txs.isMac,
  getOS: vi.fn().mockResolvedValue({ platform: "linux" }),
  getDialog: vi.fn().mockResolvedValue({
    open: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue(null),
  }),
  getWebDialog: vi.fn().mockResolvedValue({
    openWithData: vi.fn().mockResolvedValue(null),
  }),
  getFileSystem: vi.fn().mockResolvedValue({
    readFile: vi.fn().mockResolvedValue(new Uint8Array()),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readTextFile: vi.fn().mockResolvedValue(""),
    writeTextFile: vi.fn().mockResolvedValue(undefined),
    createBackup: vi.fn().mockResolvedValue(undefined),
    exportDatabase: vi.fn().mockResolvedValue(undefined),
    importDatabase: vi.fn().mockResolvedValue(undefined),
  }),
  createBackup: vi.fn().mockResolvedValue(undefined),
  setWindowAlwaysOnTop: vi.fn(),
}));

vi.mock("@/lib/platform/detect", () => ({
  isMac: () => txs.isMac,
}));

vi.mock("@/lib/db", () => ({
  getDatabase: vi.fn().mockResolvedValue({
    execute: vi.fn().mockResolvedValue({ rowsAffected: 0 }),
    select: vi.fn().mockResolvedValue([]),
    close: vi.fn().mockResolvedValue(undefined),
    exportData: vi.fn().mockResolvedValue(new Uint8Array()),
    importData: vi.fn().mockResolvedValue(undefined),
  }),
  exportDatabase: vi.fn().mockResolvedValue(new Uint8Array()),
  importDatabase: vi.fn().mockResolvedValue(undefined),
  resetDatabase: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/metrics/MetricsService", () => ({
  metricsService: {
    track: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
    flushNow: vi.fn().mockResolvedValue(undefined),
    endSession: vi.fn(),
    beginSession: vi.fn(),
    recordWordCount: vi.fn(),
    startTracking: vi.fn().mockReturnValue(vi.fn()),
  },
}));

vi.mock("@/features/backup/lifecycle", () => ({
  runDailyBackupOnce: vi.fn().mockResolvedValue(undefined),
  createLaunchBackup: vi.fn().mockResolvedValue(undefined),
  createCloseBackup: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/features/backup/backup-service", () => ({
  BackupService: vi.fn().mockImplementation(() => ({
    create: vi.fn().mockResolvedValue(undefined),
    prune: vi.fn().mockResolvedValue(undefined),
    verify: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock("@/features/sync/store", () => {
  const useSyncStore = (selector?: (s: Record<string, unknown>) => unknown) =>
    selector ? selector({}) : {};
  useSyncStore.getState = () => ({});
  return { useSyncStore };
});

vi.mock("@/features/sync/useSyncFlow", () => ({
  useSyncFlow: () => ({
    sync: vi.fn(),
    status: "idle",
  }),
}));

vi.mock("@/lib/window/closeHandler", () => ({
  installWindowCloseHandler: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/window/alwaysOnTop", () => ({
  installAlwaysOnTopReapply: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/features/sync/trayIndicator", () => ({
  installTraySyncIndicator: vi.fn(),
}));

vi.mock("@/lib/shortcuts", () => ({
  useShortcuts: vi.fn(),
}));

// ── Settings sub-component mocks ────────────────────────────────────────

vi.mock("@/components/settings/AsciiBanner", () => ({ AsciiBanner: () => null }));
vi.mock("@/components/settings/AsciiFieldBackground", () => ({ AsciiFieldBackground: () => null }));
vi.mock("@/components/settings/BackupSection", () => ({ BackupSection: () => null }));
vi.mock("@/components/settings/MetricsSection", () => ({ MetricsSection: () => null }));
vi.mock("@/components/settings/PasteCleanupSection", () => ({ PasteCleanupSection: () => null }));
vi.mock("@/components/sync/SyncControls", () => ({ SyncControls: () => null }));
vi.mock("@/components/sync/AuthDialog", () => ({ AuthDialog: () => null }));
vi.mock("@/components/sync/PassphraseDialog", () => ({ PassphraseDialog: () => null }));
vi.mock("@/components/sync/ConflictDialog", () => ({ ConflictDialog: () => null }));

// ── Metrics sub-component mocks ─────────────────────────────────────────

vi.mock("@/components/metrics/PerWorkList", () => ({ PerWorkList: () => null }));
vi.mock("@/components/metrics/StreakCard", () => ({ StreakCard: () => null }));
vi.mock("@/components/metrics/WpmChart", () => ({ WpmChart: () => null }));
vi.mock("@/components/metrics/Heatmap", () => ({ Heatmap: () => null }));
vi.mock("@/components/metrics/TimeOfDay", () => ({ TimeOfDay: () => null }));

// ── TipTap mock ─────────────────────────────────────────────────────────

vi.mock("@tiptap/react", () => ({
  useEditor: vi.fn().mockReturnValue({
    isActive: vi.fn().mockReturnValue(false),
    getHTML: vi.fn().mockReturnValue("<p>test</p>"),
    commands: {
      setContent: vi.fn(),
      focus: vi.fn(),
    },
    storage: { readingState: { caret: null, viewport: null } },
    view: { dom: document.createElement("div") },
    on: vi.fn(),
    off: vi.fn(),
    destroy: vi.fn(),
    isEditable: true,
  }),
  EditorContent: () => <div data-testid="tiptap-editor" />,
  useEditorState: vi.fn().mockReturnValue({}),
  ReactRenderer: vi.fn(),
}));

vi.mock("@tiptap/extension-placeholder", () => ({
  default: { configure: () => ({}) },
}));

vi.mock("@tiptap/extension-character-count", () => ({
  default: { configure: () => ({}) },
}));

function makeNodeMock() {
  return {
    create: () => ({
      name: "",
      group: "",
      configure: () => ({}),
      config: { addAttributes: () => ({}), addOptions: () => ({}) },
    }),
  };
}

vi.mock("@tiptap/core", () => {
  const extension = {
    create: () => ({
      name: "",
      configure: () => ({}),
      config: { addAttributes: () => ({}), addOptions: () => ({}) },
    }),
  };
  return {
    Extension: extension,
    Node: makeNodeMock(),
    Mark: extension,
  };
});

vi.mock("@tiptap/pm/state", () => {
  class PluginKey {
    key: string;
    constructor(name: string) {
      this.key = name;
    }
    getState() {
      return undefined;
    }
    get() {
      return undefined;
    }
  }
  return {
    PluginKey,
    Plugin: { create: () => ({ spec: {} }) },
    NodeSelection: { create: () => ({}) },
    TextSelection: { create: () => ({}) },
    AllSelection: { create: () => ({}) },
    Selection: { create: () => ({}) },
  };
});

// ── Editor component mocks ──────────────────────────────────────────────

vi.mock("@/components/editor/Editor", () => ({
  Editor: (props: Record<string, unknown>) => (
    <div data-testid="mocked-editor">
      {props.headerContent as React.ReactNode}
      <textarea aria-label="Editor" />
    </div>
  ),
}));

vi.mock("@/components/editor/SaveStatus", () => ({ SaveStatus: () => null }));
vi.mock("@/components/editor/FootnoteList", () => ({ FootnoteList: () => null }));
vi.mock("@/components/editor/ChapterList", () => ({
  ChapterList: () => <div data-testid="chapter-list" />,
}));
vi.mock("@/components/editor/EditorToolbar", () => ({ EditorToolbar: () => null }));
vi.mock("@/components/editor/SelectionToolbar", () => ({ SelectionToolbar: () => null }));
vi.mock("@/components/editor/LinkClickHandler", () => ({ LinkClickHandler: () => null }));
vi.mock("@/components/editor/extensions/createRichTextExtensions", () => ({
  createRichTextExtensions: () => [],
}));
vi.mock("@/components/editor/useEditorZoomControls", () => ({
  useEditorZoomControls: () => ({ zoom: 1 }),
}));

// ── React Flow mock (Canvas page) ───────────────────────────────────────

vi.mock("@xyflow/react", () => ({
  ConnectionMode: { Loose: "loose" },
  MarkerType: { ArrowClosed: "arrowclosed" },
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ReactFlow: () => <div data-testid="react-flow" />,
  Background: () => null,
  Controls: () => null,
  useReactFlow: () => ({
    fitView: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    screenToFlowPosition: (p: { x: number; y: number }) => p,
    flowToScreenPosition: (p: { x: number; y: number }) => p,
    getZoom: () => 1,
  }),
  ViewportPortal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ── Canvas sub-component mocks ──────────────────────────────────────────

vi.mock("@/features/canvas/nodes", () => ({ nodeTypes: {} }));
vi.mock("@/features/canvas/CanvasToolPanel", () => ({ CanvasToolPanel: () => null }));
vi.mock("@/features/canvas/EdgeInspectorCard", () => ({ EdgeInspectorCard: () => null }));
vi.mock("@/features/canvas/NodeColorPanel", () => ({ NodeColorPanel: () => null }));
vi.mock("@/features/canvas/PenSettingsPanel", () => ({ PenSettingsPanel: () => null }));
vi.mock("@/features/canvas/drawing/CanvasDrawingLayer", () => ({ CanvasDrawingLayer: () => null }));
vi.mock("@/features/canvas/drawing/DrawingCaptureOverlay", () => ({
  DrawingCaptureOverlay: () => null,
}));

// ── Cover designer sub-component mocks ──────────────────────────────────

vi.mock("@/components/cover-editor", async () => {
  const [{ Toolbar }, { LayersPanel }, { PropertiesPanel }] = await Promise.all([
    vi.importActual<typeof import("@/components/cover-editor/Toolbar")>(
      "@/components/cover-editor/Toolbar"
    ),
    vi.importActual<typeof import("@/components/cover-editor/panels/LayersPanel")>(
      "@/components/cover-editor/panels/LayersPanel"
    ),
    vi.importActual<typeof import("@/components/cover-editor/panels/PropertiesPanel")>(
      "@/components/cover-editor/panels/PropertiesPanel"
    ),
  ]);

  return {
    CanvasStage: () => <div data-testid="cover-canvas-stage" />,
    Toolbar,
    LayersPanel,
    PropertiesPanel,
  };
});

// ── Version store mock ──────────────────────────────────────────────────

vi.mock("@/features/versions/store", () => {
  const useVersionStore = (selector?: (s: Record<string, unknown>) => unknown) =>
    selector ? selector({}) : {};
  useVersionStore.getState = () => ({ createVersion: vi.fn().mockResolvedValue(undefined) });
  return { useVersionStore, useAutoCheckpoint: () => void 0 };
});

// ── Stores (real, not mocked) ───────────────────────────────────────────

import { useBookStore } from "@/features/books/store";
import { useNoteStore } from "@/features/notes";
import { useCanvasStore } from "@/features/canvas/store";
import { useSettingsStore } from "@/features/settings/store";
import { useChapterStore } from "@/features/chapters/store";
import { useThemeStore } from "@/features/theme/store";
import { useCoverStore } from "@/features/covers/store";

// ── Fixture helpers ─────────────────────────────────────────────────────

const TS = Math.floor(Date.now() / 1000);

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    id: "book-1",
    title: "Test Book",
    authorName: "Test Author",
    language: "en",
    wordCount: 5000,
    status: "draft",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: "note-1",
    title: "Test Note",
    content: "",
    language: "en",
    tags: [],
    pinned: false,
    order: 0,
    wordCount: 0,
    collapsedHeadings: [],
    createdAt: TS,
    updatedAt: TS,
    contentUpdatedAt: TS,
    bookId: null,
    ...overrides,
  };
}

function makeCanvas(overrides: Partial<CanvasType> = {}): CanvasType {
  return {
    id: "canvas-1",
    title: "Test Canvas",
    doc: {
      schemaVersion: 2,
      nodes: [],
      edges: [],
      strokes: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    },
    pinned: false,
    order: 0,
    createdAt: TS,
    updatedAt: TS,
    contentUpdatedAt: TS,
    ...overrides,
  };
}

// ── Test suites ─────────────────────────────────────────────────────────

beforeEach(() => {
  txs.isMac = false;
  localStorage.clear();
  useBookStore.setState({
    books: [],
    currentBook: null,
    isLoading: false,
    error: null,
  } as never);
  useNoteStore.setState({
    notes: [],
    currentNote: null,
    isLoading: false,
    error: null,
  } as never);
  useCanvasStore.setState({ canvases: [] } as never);
  useChapterStore.setState({
    chapters: [],
    currentChapter: null,
    isLoading: false,
    error: null,
  } as never);
  useSettingsStore.setState({
    editorAutoClose: false,
    mainSidebarWidth: 280,
    notesSidebarWidth: 280,
    lastNoteId: null,
    metrics: {
      enabled: { writing: false, time: false, engagement: false },
      streakDailyWordThreshold: 500,
    },
  } as never);
  useThemeStore.setState({ theme: "system" });
  useCoverStore.setState({ dirty: false } as never);
  document.documentElement.classList.remove("dark");
});

describe("Home page", () => {
  it("has a heading and no axe violations", async () => {
    useBookStore.setState({
      books: [makeBook()],
      isLoading: false,
      loadBooks: vi.fn().mockResolvedValue(undefined),
    } as never);
    const { Home } = await import("@/pages/Home");
    const { container } = render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Home />} />
        </Routes>
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.queryByText("books.loading")).not.toBeInTheDocument();
    });
    expect(container.querySelector("h1")).toHaveTextContent("books.title");
    await expectNoAxeViolations(container);
  });
});

describe("NotesGallery page", () => {
  it("has a heading and no axe violations with notes loaded", async () => {
    useNoteStore.setState({
      notes: [makeNote({ title: "My Note" })],
      isLoading: false,
      loadNotes: vi.fn().mockResolvedValue(undefined),
    } as never);
    const { NotesGallery } = await import("@/pages/NotesGallery");
    const { container } = render(
      <MemoryRouter initialEntries={["/notes"]}>
        <Routes>
          <Route path="/notes" element={<NotesGallery />} />
        </Routes>
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.queryByText("notes.title")).toBeInTheDocument();
    });
    expect(container.querySelector("h1")).toHaveTextContent("notes.title");
    await expectNoAxeViolations(container);
  });
});

describe("CanvasGallery page", () => {
  it("has a heading and no axe violations with canvases loaded", async () => {
    useCanvasStore.setState({
      canvases: [makeCanvas()],
      loadCanvases: vi.fn().mockResolvedValue(undefined),
    } as never);
    const { CanvasGallery } = await import("@/pages/CanvasGallery");
    const { container } = render(
      <MemoryRouter initialEntries={["/canvas"]}>
        <Routes>
          <Route path="/canvas" element={<CanvasGallery />} />
        </Routes>
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.queryByText("canvas.title")).toBeInTheDocument();
    });
    expect(container.querySelector("h1")).toHaveTextContent("canvas.title");
    await expectNoAxeViolations(container);
  });
});

describe("Metrics page", () => {
  it("has a heading and renders without axe violations", async () => {
    useSettingsStore.setState({
      metrics: {
        enabled: { writing: false, time: false, engagement: false },
        streakDailyWordThreshold: 500,
      },
    } as never);
    const { Metrics } = await import("@/pages/Metrics");
    const { container } = render(
      <MemoryRouter initialEntries={["/metrics"]}>
        <Routes>
          <Route path="/metrics" element={<Metrics />} />
        </Routes>
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.queryByText("metrics.title")).toBeInTheDocument();
    });
    expect(container.querySelector("h1")).toHaveTextContent("metrics.title");
    await expectNoAxeViolations(container);
  });
});

describe("Settings page", () => {
  it("has a heading and renders without axe violations", async () => {
    const { Settings } = await import("@/pages/Settings");
    const { container } = render(
      <MemoryRouter initialEntries={["/settings"]}>
        <Routes>
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.queryByText("settings.title")).toBeInTheDocument();
    });
    expect(container.querySelector("h1")).toHaveTextContent("settings.title");
    await expectNoAxeViolations(container);
  });

  it("enables autoclose from the keyboard", async () => {
    const user = userEvent.setup();
    const { Settings } = await import("@/pages/Settings");
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <Routes>
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </MemoryRouter>
    );

    const toggle = await screen.findByRole("switch", {
      name: "settings.toggleEditorAutoClose",
    });
    toggle.focus();
    await user.keyboard(" ");

    expect(useSettingsStore.getState().editorAutoClose).toBe(true);
  });
});

describe("Notes page", () => {
  it("renders a loaded note and passes axe", async () => {
    useNoteStore.setState({
      notes: [makeNote({ id: "note-1", title: "My Note" })],
      currentNote: makeNote({
        id: "note-1",
        title: "My Note",
        content: "<p>body</p>",
      }),
      isLoading: false,
      loadNotes: vi.fn().mockResolvedValue(undefined),
      loadNote: vi.fn().mockResolvedValue(undefined),
    } as never);
    useBookStore.setState({
      loadBooks: vi.fn().mockResolvedValue(undefined),
    } as never);
    const { Notes } = await import("@/pages/Notes");
    const { container } = render(
      <MemoryRouter initialEntries={["/notes/note-1"]}>
        <Routes>
          <Route path="/notes/:noteId" element={<Notes />} />
        </Routes>
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.queryByText("notes.untitled")).not.toBeInTheDocument();
    });
    await expectNoAxeViolations(container);
  });
});

describe("Canvas page", () => {
  it("renders a canvas and passes axe", async () => {
    const doc: CanvasDoc = {
      schemaVersion: 2,
      nodes: [
        {
          id: "node-1",
          kind: "text",
          html: "<p>idea</p>",
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
      strokes: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    Object.assign(useCanvasStore.getState(), {
      current: makeCanvas({ id: "canvas-1", title: "Map", doc }),
      doc,
      loadState: "ready",
      saveState: "idle",
      docLoadError: null,
      docWriteBlocked: false,
      editorReadOnly: false,
      dirty: false,
      revision: 0,
      savedRevision: 0,
      past: [],
      future: [],
      selectedNodeId: null,
      selectedEdgeId: null,
      toolMode: "select",
      penWidth: 3,
      penColor: "#ef4444",
      interactivityLocked: false,
      loadCanvas: vi.fn().mockResolvedValue(undefined),
      closeCanvas: vi.fn(),
      persistCanvas: vi.fn().mockResolvedValue(undefined),
      addNode: vi.fn(),
      addEdge: vi.fn(),
      updateEdge: vi.fn(),
      updateTextNode: vi.fn(),
      moveNodeLive: vi.fn(),
      beginLiveChange: vi.fn(),
      endLiveChange: vi.fn(),
      selectNode: vi.fn(),
      selectEdge: vi.fn(),
      clearSelection: vi.fn(),
      deleteSelection: vi.fn(),
      setViewport: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
      renameCanvas: vi.fn().mockResolvedValue(undefined),
      setToolMode: vi.fn(),
      setPenWidth: vi.fn(),
      setPenColor: vi.fn(),
      toggleInteractivityLocked: vi.fn(),
      addStroke: vi.fn(),
      removeStroke: vi.fn(),
    } as never);
    const { Canvas: CanvasPage } = await import("@/pages/Canvas");
    const { container } = render(
      <MemoryRouter initialEntries={["/canvas/canvas-1"]}>
        <Routes>
          <Route path="/canvas/:canvasId" element={<CanvasPage />} />
        </Routes>
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.queryByTestId("react-flow")).toBeInTheDocument();
    });
    await expectNoAxeViolations(container);
  });
});

describe("BookEditor page", () => {
  it("renders a loaded book and passes axe", async () => {
    useBookStore.setState({
      books: [makeBook({ id: "book-1", title: "Loaded Book" })],
      currentBook: makeBook({ id: "book-1", title: "Loaded Book" }),
      isLoading: false,
      loadBook: vi.fn().mockResolvedValue(undefined),
    } as never);
    useChapterStore.setState({
      chapters: [
        {
          id: "chapter-1",
          bookId: "book-1",
          title: "Ch 1",
          content: "<p>Hello</p>",
          order: 1,
          chapterType: "chapter",
          wordCount: 1,
          status: "draft",
          isIncludedInExport: 1,
          createdAt: TS,
          updatedAt: TS,
        },
      ],
      currentChapter: {
        id: "chapter-1",
        bookId: "book-1",
        title: "Ch 1",
        content: "<p>Hello</p>",
        order: 1,
        chapterType: "chapter",
        wordCount: 1,
        status: "draft",
        isIncludedInExport: 1,
        createdAt: TS,
        updatedAt: TS,
      },
      isLoading: false,
      loadChapters: vi.fn().mockResolvedValue(undefined),
    } as never);
    const { BookEditor } = await import("@/pages/BookEditor");
    const { container } = render(
      <MemoryRouter initialEntries={["/book/book-1"]}>
        <Routes>
          <Route path="/book/:bookId" element={<BookEditor />} />
        </Routes>
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.queryByText("editor.loading")).not.toBeInTheDocument();
    });
    await expectNoAxeViolations(container);
  });
});

describe("CoverDesigner page", () => {
  it("renders the cover designer and passes axe", async () => {
    useBookStore.setState({
      currentBook: makeBook({ id: "book-1", title: "Cover Book" }),
      isLoading: false,
      loadBook: vi.fn().mockResolvedValue(undefined),
    } as never);
    useCoverStore.setState({
      dirty: false,
      setScene: vi.fn(),
      addLayer: vi.fn(),
    } as never);
    const { CoverDesigner } = await import("@/pages/CoverDesigner");
    const { container } = render(
      <MemoryRouter initialEntries={["/book/book-1/cover"]}>
        <Routes>
          <Route path="/book/:bookId/cover" element={<CoverDesigner />} />
        </Routes>
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.queryByTestId("cover-canvas-stage")).toBeInTheDocument();
    });
    await expectNoAxeViolations(container);
  });
});
