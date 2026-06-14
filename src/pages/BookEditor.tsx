import { useParams, useNavigate, useLocation } from "react-router-dom";
import { lazy, Suspense, useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useBookStore } from "../features/books/store";
import { useChapterStore } from "../features/chapters/store";
import type { Chapter, ChapterType } from "../features/chapters/types";
import { Editor, ChapterList, SaveStatus } from "../components/editor";
import type { Editor as TiptapEditor } from "@tiptap/core";
import { BookSidePanel } from "../components/book/BookSidePanel";
import { TruncatedText } from "../components/ui/TruncatedText";
import type { EditorStats } from "../components/editor/Editor";
import { useDebouncedCallback } from "../hooks/useAutoSave";
import { ThemeToggle } from "../components/ThemeToggle";
import { ExportDialog } from "../components/export";
import {
  generateDocumentPdf,
  elementToPngBytes,
  saveBinaryFile,
  exportFilename,
} from "../features/export";
import {
  editorHtmlToMarkdown,
  markdownFilename,
  markdownToEditorHtml,
  saveMarkdownFile,
  titleFromMarkdown,
} from "../features/markdown";
import { useTranslation } from "react-i18next";
import {
  BackIcon,
  ExportIcon,
  CoverDesignIcon,
  FocusModeIcon,
  DocumentIcon,
  SettingsIcon,
  CloseIcon,
  MaibukLogo,
} from "../components/icons";
import { BookSettingsDialog } from "../components/book/BookSettingsDialog";
import { deriveNoteTitle } from "../components/book/deriveNoteTitle";
import { useNoteStore } from "../features/notes";
import { useSettingsStore } from "../features/settings/store";
import {
  History,
  Menu,
  MoreVertical,
  NotebookText,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
} from "lucide-react";
import { SyncStatusButton } from "../components/sync/SyncStatusButton";
import { HistoryMenuButton } from "../components/versions/HistoryMenuButton";
import { useShortcuts } from "../lib/shortcuts";
import { IS_TAURI, isMac } from "../lib/platform";
import { useAutoCheckpoint } from "../features/versions/useAutoCheckpoint";
import { useVersionStore } from "../features/versions/store";
import { Modal } from "../components/ui/Modal";
import { Input } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { toast } from "../components/ui/Toast";
import { metricsService } from "../lib/metrics/MetricsService";

const VersionPanel = lazy(() =>
  import("../components/versions/VersionPanel").then((module) => ({
    default: module.VersionPanel,
  }))
);

export function BookEditor() {
  const { t } = useTranslation();
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  // Stores
  const {
    currentBook,
    isLoading: isBookLoading,
    loadBook,
    updateWordCount,
    updateBook,
    deleteBook,
  } = useBookStore();
  const {
    chapters,
    currentBookId,
    currentChapter,
    isLoading: areChaptersLoading,
    loadChapters,
    createChapter,
    updateChapter,
    deleteChapter,
    reorderChapters,
    setCurrentChapter,
  } = useChapterStore();

  // Local state
  const [focusMode, setFocusMode] = useState(false);
  const [wordCount, setWordCount] = useState(0);
  const [editorStats, setEditorStats] = useState<EditorStats | null>(null);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "idle">(
    "idle",
  );
  const [showMobileChapters, setShowMobileChapters] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [tocEditor, setTocEditor] = useState<TiptapEditor | null>(null);
  const [showSidebar, setShowSidebar] = useState(true);
  const [showVersionPanel, setShowVersionPanel] = useState(false);
  const [showSaveVersionDialog, setShowSaveVersionDialog] = useState(false);
  const [saveVersionName, setSaveVersionName] = useState("");
  const sidebarWidth = useSettingsStore((s) => s.sidebarWidth);
  const setSidebarWidth = useSettingsStore((s) => s.setSidebarWidth);
  const notesSidebarWidth = useSettingsStore((s) => s.notesSidebarWidth);
  const setNotesSidebarWidth = useSettingsStore((s) => s.setNotesSidebarWidth);
  const isResizing = useRef(false);
  const showInlineFootnotes = useSettingsStore((s) => s.showInlineFootnotes);
  const showNotesChapter = useSettingsStore((s) => s.showNotesChapter);
  const setShowNotesChapter = useSettingsStore((s) => s.setShowNotesChapter);
  const bookSidePanelTab = useSettingsStore((s) => s.bookSidePanelTab);
  const setBookSidePanelTab = useSettingsStore((s) => s.setBookSidePanelTab);
  const hideKeyboardHints = useSettingsStore((s) => s.hideKeyboardHints);
  const alwaysOnTop = useSettingsStore((s) => s.alwaysOnTop);
  const setAlwaysOnTop = useSettingsStore((s) => s.setAlwaysOnTop);
  const saveVersionShortcut = isMac() ? "⌘⌥S" : "Ctrl+Alt+S";
  const panelShortcut = "g v";

  const allNotes = useNoteStore((s) => s.notes);
  const loadNotes = useNoteStore((s) => s.loadNotes);
  const createNote = useNoteStore((s) => s.createNote);
  const bookNotes = useMemo(
    () => allNotes.filter((note) => note.bookId === bookId),
    [allNotes, bookId],
  );

  useEffect(() => {
    if (showNotesChapter && bookSidePanelTab === "notes") void loadNotes();
  }, [showNotesChapter, bookSidePanelTab, loadNotes]);

  const handleCreateBookNote = useCallback(
    (html: string) => {
      if (!bookId) return;
      void createNote({ bookId, title: deriveNoteTitle(html), content: html });
    },
    [bookId, createNote],
  );

  const handleOpenBookNote = useCallback(
    (noteId: string) => {
      navigate("/notes", {
        state: {
          openNoteId: noteId,
          returnTo: `/book/${bookId}`,
          returnLabel: currentBook?.title ?? "",
        },
      });
    },
    [navigate, bookId, currentBook?.title],
  );

  // Ref to store the latest editor content
  const editorContentRef = useRef<string>("");

  // Load book and chapters
  useEffect(() => {
    if (bookId) {
      loadBook(bookId);
      loadChapters(bookId);
    }
  }, [bookId, loadBook, loadChapters]);

  // Auto-select chapter: restore last edited or default to last chapter
  useEffect(() => {
    // Wait for both book and chapters to be loaded for the correct book
    if (
      chapters.length > 0 &&
      !currentChapter &&
      currentBook &&
      currentBook.id === bookId
    ) {
      const lastEditedChapter = currentBook.lastChapterId
        ? chapters.find((c) => c.id === currentBook.lastChapterId)
        : null;
      // Use last edited chapter if found, otherwise default to last chapter
      setCurrentChapter(lastEditedChapter ?? chapters[chapters.length - 1]);
    }
  }, [chapters, currentChapter, currentBook, bookId, setCurrentChapter]);

  // Deep-link: open target chapter and scroll to heading from navigation state
  useEffect(() => {
    const state = location.state as {
      openChapterId?: string;
      scrollToHeadingId?: string;
    } | null;
    if (!state?.openChapterId || chapters.length === 0) return;

    const target = chapters.find((c) => c.id === state.openChapterId);
    if (target) {
      setCurrentChapter(target);
      if (state.scrollToHeadingId) {
        const headingId = state.scrollToHeadingId;
        // Wait for the editor to render the chapter, then scroll to the anchor.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            document.getElementById(headingId)?.scrollIntoView({
              behavior: "smooth",
              block: "start",
            });
          });
        });
      }
    }
    // Clear the navigation state so re-renders don't re-trigger.
    navigate(location.pathname, { replace: true, state: null });
  }, [chapters, location, navigate, setCurrentChapter]);

  // Update word count display and sync editor content ref when chapter changes
  useEffect(() => {
    if (currentChapter) {
      setWordCount(currentChapter.wordCount);
      // Initialize the ref with the current chapter content
      editorContentRef.current = currentChapter.content || "";
    }
  }, [currentChapter?.id]);

  // Calculate total book word count when chapters change
  useEffect(() => {
    if (bookId && chapters.length > 0) {
      const totalWords = chapters.reduce((sum, c) => sum + c.wordCount, 0);
      updateWordCount(bookId, totalWords);
    }
  }, [bookId, chapters, updateWordCount]);

  // Compute book-wise footnote start index for the current chapter
  const footnoteStartIndex = useMemo(() => {
    if (!currentChapter) return 1;
    let count = 0;
    for (const ch of chapters) {
      if (ch.order < currentChapter.order) {
        if (ch.content) {
          const matches = ch.content.match(/<sup[^>]+data-footnote/g);
          count += matches ? matches.length : 0;
        }
      }
    }
    return count + 1;
  }, [chapters, currentChapter]);

  // Total book word count for auto-checkpoint
  const totalBookWordCount = useMemo(
    () => chapters.reduce((sum, c) => sum + c.wordCount, 0),
    [chapters]
  );

  useAutoCheckpoint({
    bookId,
    wordCount: totalBookWordCount,
    enabled: !!currentBook,
  });

  // Flush latest editor content to the database immediately
  const flushEditorContent = useCallback(async () => {
    const content = editorContentRef.current;
    if (currentChapter && content) {
      await updateChapter(currentChapter.id, { content });
    }
  }, [currentChapter, updateChapter]);

  // Export the current chapter as a Markdown file
  const handleExportMarkdown = useCallback(async () => {
    if (!currentChapter) return;
    const html = editorContentRef.current || currentChapter.content || "";
    try {
      const markdown = editorHtmlToMarkdown(html);
      const saved = await saveMarkdownFile(
        markdownFilename(currentChapter.title),
        markdown,
      );
      if (saved) toast.success(t("editor.exportMarkdownSuccess"));
    } catch (error) {
      console.error("Markdown export failed:", error);
      toast.error(t("editor.exportMarkdownFailed"));
    }
  }, [currentChapter, t]);

  // Export the current chapter as a PDF file
  const handleExportPdf = useCallback(async () => {
    if (!currentChapter) return;
    const html = editorContentRef.current || currentChapter.content || "";
    try {
      const blob = await generateDocumentPdf(html, currentChapter.title);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const saved = await saveBinaryFile(
        exportFilename(currentChapter.title, "pdf"),
        bytes,
        "application/pdf",
        { name: "PDF", extensions: ["pdf"] },
      );
      if (saved) toast.success(t("editor.exportPdfSuccess"));
    } catch (error) {
      console.error("PDF export failed:", error);
      toast.error(t("editor.exportPdfFailed"));
    }
  }, [currentChapter, t]);

  // Export the current chapter as a PNG image
  const handleExportImage = useCallback(async () => {
    if (!currentChapter || !tocEditor) return;
    try {
      const bytes = await elementToPngBytes(tocEditor.view.dom as HTMLElement);
      const saved = await saveBinaryFile(
        exportFilename(currentChapter.title, "png"),
        bytes,
        "image/png",
        { name: "PNG Image", extensions: ["png"] },
      );
      if (saved) toast.success(t("editor.exportImageSuccess"));
    } catch (error) {
      console.error("Image export failed:", error);
      toast.error(t("editor.exportImageFailed"));
    }
  }, [currentChapter, tocEditor, t]);

  // triggered save - uses ref to get latest editor content
  const handleSaveNow = useCallback(async () => {
    setSaveStatus("saving");
    try {
      await flushEditorContent();
      setSaveStatus("saved");
      // Reset to idle after 2 seconds
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch (error) {
      console.error("Failed to save:", error);
      setSaveStatus("idle");
    }
  }, [flushEditorContent]);

  // Debounced auto-save
  const debouncedSave = useDebouncedCallback(
    async (chapterId: string, content: string) => {
      setSaveStatus("saving");
      try {
        await updateChapter(chapterId, { content });
        setSaveStatus("saved");
        // Reset to idle after 2 seconds
        setTimeout(() => setSaveStatus("idle"), 2000);
      } catch (error) {
        console.error("Failed to save:", error);
        setSaveStatus("idle");
      }
    },
    1000,
  );

  // Handle content changes
  const handleContentUpdate = useCallback(
    (content: string) => {
      if (currentChapter) {
        // Update the ref with the latest content
        editorContentRef.current = content;
        debouncedSave(currentChapter.id, content);
      }
    },
    [currentChapter, debouncedSave],
  );

  // Handle word count changes
  const handleWordCountChange = useCallback((count: number) => {
    setWordCount(count);
  }, []);

  // Handle editor stats changes (selection-aware)
  const handleStatsChange = useCallback((stats: EditorStats) => {
    setEditorStats(stats);
  }, []);

  // Receive the editor instance for the table-of-contents panel
  const handleEditorReady = useCallback((editor: TiptapEditor | null) => {
    setTocEditor(editor);
  }, []);

  // Chapter management handlers
  const handleSelectChapter = useCallback(
    (chapter: Chapter) => {
      metricsService.endSession();
      void metricsService.flushNow();
      setCurrentChapter(chapter);
      // Save as last edited chapter for this book
      if (bookId) {
        updateBook(bookId, { lastChapterId: chapter.id });
      }
    },
    [bookId, setCurrentChapter, updateBook],
  );

  const handleCreateChapter = useCallback(
    async (title: string, type: ChapterType) => {
      if (bookId) {
        const newChapter = await createChapter({
          bookId,
          title,
          chapterType: type,
        });
        metricsService.endSession();
        void metricsService.flushNow();
        setCurrentChapter(newChapter);
        // Save as last edited chapter
        updateBook(bookId, { lastChapterId: newChapter.id });
      }
    },
    [bookId, createChapter, setCurrentChapter, updateBook],
  );

  const handleImportMarkdown = useCallback(
    async (markdown: string, filenameStem: string) => {
      if (!bookId) return;
      try {
        const title = titleFromMarkdown(markdown, filenameStem);
        const html = markdownToEditorHtml(markdown);
        const newChapter = await createChapter({ bookId, title });
        await updateChapter(newChapter.id, { content: html });
        setCurrentChapter({ ...newChapter, content: html });
        updateBook(bookId, { lastChapterId: newChapter.id });
      } catch (error) {
        console.error("Markdown import failed:", error);
        toast.error(t("editor.importMarkdownFailed"));
      }
    },
    [bookId, createChapter, updateChapter, setCurrentChapter, updateBook, t],
  );

  const handleDeleteChapter = useCallback(
    async (id: string) => {
      await deleteChapter(id);
      // Select another chapter if we deleted the current one
      if (currentChapter?.id === id) {
        const remaining = chapters.filter((c) => c.id !== id);
        metricsService.endSession();
        void metricsService.flushNow();
        setCurrentChapter(remaining.length > 0 ? remaining[0] : null);
      }
    },
    [deleteChapter, currentChapter, chapters, setCurrentChapter],
  );

  const handleReorderChapters = useCallback(
    async (chapterIds: string[]) => {
      if (bookId) {
        await reorderChapters(bookId, chapterIds);
      }
    },
    [bookId, reorderChapters],
  );

  const handleUpdateChapter = useCallback(
    async (id: string, title: string, chapterType: ChapterType) => {
      await updateChapter(id, { title, chapterType });
    },
    [updateChapter],
  );

  // Toggle focus mode
  const toggleFocusMode = useCallback(() => {
    setFocusMode((prev) => !prev);
  }, []);

  // Sidebar drag-resize handler
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizing.current = true;
      const startX = e.clientX;
      const startWidth = sidebarWidth;

      const onMouseMove = (moveEvent: MouseEvent) => {
        if (!isResizing.current) return;
        const newWidth = Math.max(
          200,
          Math.min(480, startWidth + moveEvent.clientX - startX),
        );
        setSidebarWidth(newWidth);
      };

      const onMouseUp = () => {
        isResizing.current = false;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [sidebarWidth],
  );

  // Notes/footnotes side panel drag-resize handler. The panel sits on the right,
  // so dragging its left edge leftwards widens it (inverted delta).
  const handleNotesResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizing.current = true;
      const startX = e.clientX;
      const startWidth = notesSidebarWidth;

      const onMouseMove = (moveEvent: MouseEvent) => {
        if (!isResizing.current) return;
        const newWidth = Math.max(
          200,
          Math.min(480, startWidth - (moveEvent.clientX - startX)),
        );
        setNotesSidebarWidth(newWidth);
      };

      const onMouseUp = () => {
        isResizing.current = false;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [notesSidebarWidth, setNotesSidebarWidth],
  );

  // Handle book info update
  const handleUpdateBookInfo = useCallback(
    async (input: Parameters<typeof updateBook>[1]) => {
      if (bookId) {
        await updateBook(bookId, input);
      }
    },
    [bookId, updateBook],
  );

  // Handle book deletion
  const handleDeleteBook = useCallback(async () => {
    if (bookId) {
      await deleteBook(bookId);
      navigate("/");
    }
  }, [bookId, deleteBook, navigate]);

  // Manual save-version: flush then create a named version
  const handleSaveVersion = useCallback(async () => {
    if (!bookId) return;
    await flushEditorContent();
    setSaveVersionName("");
    setShowSaveVersionDialog(true);
  }, [bookId, flushEditorContent]);

  const handleConfirmSaveVersion = useCallback(async () => {
    if (!bookId) return;
    const created = await useVersionStore
      .getState()
      .createVersion({
        bookId,
        name: saveVersionName.trim() || undefined,
        triggerType: "manual",
      });
    setShowSaveVersionDialog(false);
    if (created) {
      toast.success(t("versions.saveVersion"));
    } else {
      toast.success(t("versions.alreadyUpToDate"));
    }
  }, [bookId, saveVersionName, t]);

  // Close trigger: keyed on bookId only so it fires on book change/unmount,
  // not on chapter switches (which would otherwise re-run via flushEditorContent's identity).
  const flushEditorContentRef = useRef(flushEditorContent);
  useEffect(() => {
    flushEditorContentRef.current = flushEditorContent;
  }, [flushEditorContent]);
  useEffect(() => {
    return () => {
      if (!bookId) return;
      metricsService.endSession();
      // Fire-and-forget: the unmount cleanup cannot await reliably.
      void (async () => {
        await metricsService.flushNow();
        await flushEditorContentRef.current();
        await useVersionStore
          .getState()
          .createVersion({ bookId, triggerType: "close" });
      })();
    };
  }, [bookId]);

  useShortcuts([
    {
      keys: "escape",
      onTrigger: () => setFocusMode(false),
      enabled: focusMode,
      allowInInput: true,
    },
    {
      keys: ["f11", "ctrl+shift+f", "meta+shift+f"],
      onTrigger: () => toggleFocusMode(),
      allowInInput: true,
    },
    {
      keys: ["ctrl+s", "meta+s"],
      onTrigger: () => {
        handleSaveNow();
      },
      allowInInput: true,
    },
    {
      keys: ["ctrl+\\", "meta+\\"],
      onTrigger: () => {
        setShowSidebar((prev) => {
          if (!prev) setSidebarWidth(256);
          return !prev;
        });
      },
    },
    {
      keys: "backspace",
      onTrigger: () => {
        navigate("/");
      },
    },
    {
      keys: ["ctrl+alt+s", "meta+alt+s"],
      onTrigger: () => {
        void handleSaveVersion();
      },
      allowInInput: true,
    },
    {
      sequence: ["g", "v"],
      onTrigger: () => {
        setShowVersionPanel(true);
      },
    },
  ]);

  const isBookPreparing =
    isBookLoading || !currentBook || currentBook.id !== bookId;
  const isChapterPreparing =
    areChaptersLoading ||
    currentBookId !== bookId ||
    (chapters.length > 0 && !currentChapter);

  if (isBookPreparing) {
    return (
      <div className="flex items-center justify-center h-dvh bg-background">
        <div className="flex flex-col items-center gap-3">
          <MaibukLogo className="w-16 h-16 loading-entrance text-primary" />
          <p className="text-muted-foreground">{t("editor.loading")}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex h-dvh overflow-hidden ${focusMode ? "focus-mode" : ""}`}
    >
      {/* Mobile chapter drawer overlay */}
      {showMobileChapters && !focusMode && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => setShowMobileChapters(false)}
          onKeyDown={() => setShowMobileChapters(false)}
        />
      )}

      {/* Chapter sidebar */}
      {!focusMode && (
        <>
          {/* Mobile drawer */}
          <div
            className={`
              md:hidden fixed z-50 w-72
              h-full transform transition-transform duration-300 ease-in-out
              ${showMobileChapters ? "translate-x-0" : "-translate-x-full"}
            `}
          >
            <button
              type="button"
              onClick={() => setShowMobileChapters(false)}
              className="absolute top-3 right-3 z-10 p-2 hover:bg-muted rounded-lg transition-colors"
              aria-label="Close chapters"
            >
              <CloseIcon className="w-5 h-5" />
            </button>
            <ChapterList
              chapters={chapters}
              currentChapterId={currentChapter?.id ?? null}
              editor={tocEditor}
              onSelectChapter={(chapter) => {
                handleSelectChapter(chapter);
                setShowMobileChapters(false);
              }}
              onCreateChapter={handleCreateChapter}
              onUpdateChapter={handleUpdateChapter}
              onDeleteChapter={handleDeleteChapter}
              onReorderChapters={handleReorderChapters}
              onImportMarkdown={handleImportMarkdown}
            />
          </div>

          {/* Desktop sidebar — width controlled by drag */}
          <div
            className="hidden md:flex h-full relative shrink-0"
            style={{
              width: showSidebar ? `${sidebarWidth}px` : 0,
              overflow: showSidebar ? undefined : "hidden",
            }}
          >
            <ChapterList
              chapters={chapters}
              currentChapterId={currentChapter?.id ?? null}
              editor={tocEditor}
              onSelectChapter={handleSelectChapter}
              onCreateChapter={handleCreateChapter}
              onUpdateChapter={handleUpdateChapter}
              onDeleteChapter={handleDeleteChapter}
              onReorderChapters={handleReorderChapters}
              onImportMarkdown={handleImportMarkdown}
            />
            {showSidebar && (
              <div
                onMouseDown={handleResizeStart}
                className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors"
              />
            )}
          </div>
        </>
      )}

      {/* Main editor area */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0">
        {/* Header bar - hidden in focus mode */}
        {!focusMode && (
          <div className="h-12 border-b border-border flex items-center px-2 sm:px-4 gap-1 sm:gap-2 md:gap-4">
            {/* Mobile chapter toggle */}
            <button
              type="button"
              onClick={() => setShowMobileChapters(true)}
              className="md:hidden p-2 hover:bg-muted rounded transition-colors"
              title={t("chapters.title")}
            >
              <Menu className="w-5 h-5" />
            </button>

            <button
              type="button"
              onClick={() => navigate("/")}
              className="p-2 hover:bg-muted rounded transition-colors"
              title={t("nav.backToHome")}
            >
              <BackIcon className="w-5 h-5" />
            </button>

            {/* Desktop sidebar toggle */}
            <button
              type="button"
              onClick={() =>
                setShowSidebar((prev) => {
                  if (!prev) setSidebarWidth(256);
                  return !prev;
                })
              }
              className="hidden md:block p-2 hover:bg-muted rounded transition-colors"
              title={
                showSidebar
                  ? t("chapters.hideSidebar")
                  : t("chapters.showSidebar")
              }
            >
              {showSidebar ? (
                <PanelLeftClose className="w-5 h-5" />
              ) : (
                <PanelLeftOpen className="w-5 h-5" />
              )}
            </button>

            <div className="flex-1 min-w-0">
              <TruncatedText
                as="h1"
                text={currentBook.title}
                className="font-medium truncate text-sm sm:text-base"
              />
              {currentChapter && (
                <TruncatedText
                  as="p"
                  text={currentChapter.title}
                  className="text-xs text-muted-foreground truncate"
                />
              )}
            </div>

            {/* Save status */}
            <SaveStatus
              status={saveStatus}
              onSave={() => {
                handleSaveNow();
              }}
              disabled={!currentChapter?.content}
              saveShortcut="Ctrl+S"
            />

            {/* Sync */}
            <SyncStatusButton />
            <div className="hidden md:block">
              <HistoryMenuButton
                onOpenPanel={() => setShowVersionPanel(true)}
                onSaveVersion={() => void handleSaveVersion()}
                saveVersionShortcut={saveVersionShortcut}
                panelShortcut={panelShortcut}
              />
            </div>
            <button
              type="button"
              onClick={() => {
                setBookSidePanelTab("notes");
                setShowNotesChapter(true);
              }}
              disabled={showNotesChapter && bookSidePanelTab === "notes"}
              className="hidden md:inline-flex p-2 hover:bg-muted rounded transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
              title={t("nav.bookNotes")}
            >
              <NotebookText className="w-5 h-5" />
            </button>

            {/* Word count - hidden on mobile */}
            <div className="hidden sm:block text-sm text-muted-foreground">
              {editorStats?.hasSelection ? (
                <span title={t("editor.selectionStats")}>
                  {editorStats.words.toLocaleString()} {t("common.words")} /{" "}
                  {editorStats.characters.toLocaleString()} {t("common.chars")}
                </span>
              ) : (
                <span>
                  {wordCount.toLocaleString()} {t("common.words")}
                </span>
              )}
            </div>

            {/* Desktop action buttons */}
            <div className="hidden md:flex items-center gap-1">
              {/* Export button */}
              <button
                type="button"
                onClick={() => setShowExportDialog(true)}
                className="p-2 hover:bg-muted rounded transition-colors"
                title={t("nav.exportBook")}
              >
                <ExportIcon className="w-5 h-5" />
              </button>

              {/* Design Cover button */}
              <button
                type="button"
                onClick={() => navigate(`/book/${bookId}/cover`)}
                className="p-2 hover:bg-muted rounded transition-colors"
                title={t("nav.designCover")}
              >
                <CoverDesignIcon className="w-5 h-5" />
              </button>

              {/* Book Settings button */}
              <button
                type="button"
                onClick={() => setShowSettingsDialog(true)}
                className="p-2 hover:bg-muted rounded transition-colors"
                title={t("bookSettings.title")}
              >
                <SettingsIcon className="w-5 h-5" />
              </button>

              {/** Theme toggle */}
              <ThemeToggle variant="dropdown" />

              {IS_TAURI && (
                <button
                  type="button"
                  onClick={() => setAlwaysOnTop(!alwaysOnTop)}
                  className={`p-2 rounded transition-colors ${alwaysOnTop
                      ? "bg-muted text-primary"
                      : "hover:bg-muted text-foreground"
                    }`}
                  title={t("settings.alwaysOnTop")}
                >
                  <Pin className="w-5 h-5" />
                </button>
              )}

              {/* Focus mode toggle */}
              <button
                type="button"
                onClick={toggleFocusMode}
                className="p-2 hover:bg-muted rounded transition-colors"
                title={t("nav.focusMode")}
              >
                <FocusModeIcon className="w-5 h-5" />
              </button>
            </div>

            {/* Mobile more menu */}
            <div className="md:hidden relative">
              <button
                type="button"
                onClick={() => setShowMobileMenu(!showMobileMenu)}
                className="p-2 hover:bg-muted rounded transition-colors"
                title={t("common.more")}
              >
                <MoreVertical className="w-5 h-5" />
              </button>

              {showMobileMenu && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowMobileMenu(false)}
                    onKeyDown={() => setShowMobileMenu(false)}
                  />
                  <div className="absolute right-0 top-full mt-1 w-48 bg-background border border-border rounded-lg shadow-lg z-50 dropdown-enter">
                    <button
                      type="button"
                      onClick={() => {
                        setBookSidePanelTab("notes");
                        setShowNotesChapter(true);
                        setShowMobileMenu(false);
                      }}
                      disabled={showNotesChapter && bookSidePanelTab === "notes"}
                      className="w-full px-4 py-2 text-left hover:bg-muted flex items-center gap-2 disabled:opacity-40 disabled:hover:bg-transparent"
                    >
                      <NotebookText className="w-4 h-4" />
                      {t("nav.bookNotes")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowExportDialog(true);
                        setShowMobileMenu(false);
                      }}
                      className="w-full px-4 py-2 text-left hover:bg-muted flex items-center gap-2"
                    >
                      <ExportIcon className="w-4 h-4" />
                      {t("nav.exportBook")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        navigate(`/book/${bookId}/cover`);
                        setShowMobileMenu(false);
                      }}
                      className="w-full px-4 py-2 text-left hover:bg-muted flex items-center gap-2"
                    >
                      <CoverDesignIcon className="w-4 h-4" />
                      {t("nav.designCover")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowSettingsDialog(true);
                        setShowMobileMenu(false);
                      }}
                      className="w-full px-4 py-2 text-left hover:bg-muted flex items-center gap-2"
                    >
                      <SettingsIcon className="w-4 h-4" />
                      {t("bookSettings.title")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void handleSaveVersion();
                        setShowMobileMenu(false);
                      }}
                      className="w-full px-4 py-2 text-left hover:bg-muted flex items-center gap-2"
                    >
                      <History className="w-4 h-4" />
                      {t("versions.saveVersion")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowVersionPanel(true);
                        setShowMobileMenu(false);
                      }}
                      className="w-full px-4 py-2 text-left hover:bg-muted flex items-center gap-2"
                    >
                      <History className="w-4 h-4" />
                      {t("versions.showHistory")}
                    </button>
                    {IS_TAURI && (
                      <button
                        type="button"
                        onClick={() => {
                          setAlwaysOnTop(!alwaysOnTop);
                          setShowMobileMenu(false);
                        }}
                        className="w-full px-4 py-2 text-left hover:bg-muted flex items-center gap-2"
                      >
                        <Pin className="w-4 h-4" />
                        {t("settings.alwaysOnTop")}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        toggleFocusMode();
                        setShowMobileMenu(false);
                      }}
                      className="w-full px-4 py-2 text-left hover:bg-muted flex items-center gap-2"
                    >
                      <FocusModeIcon className="w-4 h-4" />
                      {t("nav.focusMode")}
                    </button>
                    <div className="px-4 py-2 border-t border-border">
                      <ThemeToggle />
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Editor */}
        {currentChapter ? (
          <Editor
            key={currentChapter.id}
            content={currentChapter.content}
            onUpdate={handleContentUpdate}
            onWordCountChange={handleWordCountChange}
            onStatsChange={handleStatsChange}
            onEditorReady={handleEditorReady}
            onBlur={() => {
              metricsService.endSession();
              void metricsService.flushNow();
            }}
            focusMode={focusMode}
            footnoteStartIndex={footnoteStartIndex}
            showInlineFootnotes={showInlineFootnotes}
            bookId={bookId ?? null}
            chapterId={currentChapter.id}
            placeholder={`Start writing "${currentChapter.title}"...`}
            onExportMarkdown={handleExportMarkdown}
            onExportPdf={handleExportPdf}
            onExportImage={handleExportImage}
          />
        ) : isChapterPreparing ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-muted-foreground">
              <MaibukLogo className="w-16 h-16 loading-entrance text-primary" />
              <span className="text-sm">{t("editor.loadingEditor")}</span>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-muted-foreground">
              <DocumentIcon className="w-16 h-16 mx-auto mb-4 opacity-50" />
              <p className="text-lg mb-2">{t("editor.noChapter")}</p>
              <p className="text-sm">{t("editor.createNewChapter")}</p>
            </div>
          </div>
        )}

        {/* Focus mode exit hint */}
        {focusMode && !hideKeyboardHints && (
          <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-black/70 text-white px-4 py-2 rounded-full text-sm opacity-0 hover:opacity-100 transition-opacity">
            {t("editor.press")}{" "}
            <kbd className="px-2 py-0.5 bg-white/20 rounded mx-1">Esc</kbd>{" "}
            {t("editor.or")}{" "}
            <kbd className="px-2 py-0.5 bg-white/20 rounded mx-1">F11</kbd>{" "}
            {t("editor.exitFocus")}
          </div>
        )}
      </div>

      {/* Book Side Panel (footnotes + book notes) */}
      <BookSidePanel
        isOpen={showNotesChapter && !focusMode}
        activeTab={bookSidePanelTab}
        onTabChange={setBookSidePanelTab}
        onClose={() => setShowNotesChapter(false)}
        width={notesSidebarWidth}
        onResizeStart={handleNotesResizeStart}
        chapters={chapters}
        currentChapterId={currentChapter?.id ?? null}
        onSelectChapter={handleSelectChapter}
        notes={bookNotes}
        onCreateNote={handleCreateBookNote}
        onOpenNote={handleOpenBookNote}
      />

      {/* Export Dialog */}
      <ExportDialog
        isOpen={showExportDialog}
        onClose={() => setShowExportDialog(false)}
        book={currentBook}
        chapters={chapters}
      />

      {/* Book Settings Dialog */}
      <BookSettingsDialog
        isOpen={showSettingsDialog}
        onClose={() => setShowSettingsDialog(false)}
        book={currentBook}
        onUpdateBookInfo={handleUpdateBookInfo}
        onDelete={handleDeleteBook}
      />

      {/* Version Panel */}
      {bookId && showVersionPanel && (
        <Suspense fallback={null}>
          <VersionPanel
            isOpen={showVersionPanel}
            onClose={() => setShowVersionPanel(false)}
            bookId={bookId}
            flushBeforeCompare={flushEditorContent}
          />
        </Suspense>
      )}

      {/* Save Version Name Dialog */}
      <Modal
        isOpen={showSaveVersionDialog}
        onClose={() => setShowSaveVersionDialog(false)}
        title={t("versions.namePrompt")}
        footer={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => setShowSaveVersionDialog(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              onClick={() => void handleConfirmSaveVersion()}
            >
              {t("versions.saveVersion")}
            </Button>
          </div>
        }
      >
        <Input
          value={saveVersionName}
          onChange={(e) => setSaveVersionName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void handleConfirmSaveVersion();
            }
          }}
          placeholder={t("versions.namePlaceholder")}
          autoFocus
        />
      </Modal>
    </div>
  );
}
