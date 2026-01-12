import { useParams, useNavigate } from "react-router-dom";
import { useEffect, useState, useCallback, useRef } from "react";
import { useBookStore } from "../features/books/store";
import { useChapterStore } from "../features/chapters/store";
import type { Chapter, ChapterType } from "../features/chapters/types";
import { Editor, ChapterList } from "../components/editor";
import { useDebouncedCallback } from "../hooks/useAutoSave";
import { ThemeToggle } from "../components/ThemeToggle";
import { ExportDialog } from "../components/export";
import { useTranslation } from "react-i18next";
import { SpinnerIcon, CheckIcon, BackIcon, SaveIcon, ExportIcon, CoverDesignIcon, FocusModeIcon, DocumentIcon, SettingsIcon } from "../components/icons";
import { BookSettingsDialog } from "../components/book/BookSettingsDialog";

export function BookEditor() {
  const { t } = useTranslation();
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();

  // Stores
  const { currentBook, loadBook, updateWordCount, updateBook, deleteBook } = useBookStore();
  const {
    chapters,
    currentChapter,
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
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "idle">("idle");

  // Ref to store the latest editor content
  const editorContentRef = useRef<string>("");

  // Load book and chapters
  useEffect(() => {
    if (bookId) {
      loadBook(bookId);
      loadChapters(bookId);
    }
  }, [bookId, loadBook, loadChapters]);

  // Auto-select first chapter if none selected
  useEffect(() => {
    if (chapters.length > 0 && !currentChapter) {
      setCurrentChapter(chapters[0]);
    }
  }, [chapters, currentChapter, setCurrentChapter]);

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

  // triggered save - uses ref to get latest editor content
  const handleSaveNow = useCallback(async () => {
    const content = editorContentRef.current;
    if (currentChapter && content) {
      setSaveStatus("saving");
      try {
        await updateChapter(currentChapter.id, { content });
        setSaveStatus("saved");
        // Reset to idle after 2 seconds
        setTimeout(() => setSaveStatus("idle"), 2000);
      } catch (error) {
        console.error("Failed to save:", error);
        setSaveStatus("idle");
      }
    }
  }, [currentChapter, updateChapter]);

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
    1000
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
    [currentChapter, debouncedSave]
  );

  // Handle word count changes
  const handleWordCountChange = useCallback((count: number) => {
    setWordCount(count);
  }, []);

  // Chapter management handlers
  const handleSelectChapter = useCallback(
    (chapter: Chapter) => {
      setCurrentChapter(chapter);
    },
    [setCurrentChapter]
  );

  const handleCreateChapter = useCallback(
    async (title: string, type: ChapterType) => {
      if (bookId) {
        const newChapter = await createChapter({
          bookId,
          title,
          chapterType: type,
        });
        setCurrentChapter(newChapter);
      }
    },
    [bookId, createChapter, setCurrentChapter]
  );

  const handleDeleteChapter = useCallback(
    async (id: string) => {
      await deleteChapter(id);
      // Select another chapter if we deleted the current one
      if (currentChapter?.id === id) {
        const remaining = chapters.filter((c) => c.id !== id);
        setCurrentChapter(remaining.length > 0 ? remaining[0] : null);
      }
    },
    [deleteChapter, currentChapter, chapters, setCurrentChapter]
  );

  const handleReorderChapters = useCallback(
    async (chapterIds: string[]) => {
      if (bookId) {
        await reorderChapters(bookId, chapterIds);
      }
    },
    [bookId, reorderChapters]
  );

  const handleUpdateChapter = useCallback(
    async (id: string, title: string, chapterType: ChapterType) => {
      await updateChapter(id, { title, chapterType });
    },
    [updateChapter]
  );

  // Toggle focus mode
  const toggleFocusMode = useCallback(() => {
    setFocusMode((prev) => !prev);
  }, []);

  // Handle book info update
  const handleUpdateBookInfo = useCallback(
    async (input: Parameters<typeof updateBook>[1]) => {
      if (bookId) {
        await updateBook(bookId, input);
      }
    },
    [bookId, updateBook]
  );

  // Handle book deletion
  const handleDeleteBook = useCallback(async () => {
    if (bookId) {
      await deleteBook(bookId);
      navigate("/");
    }
  }, [bookId, deleteBook, navigate]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape to exit focus mode
      if (e.key === "Escape" && focusMode) {
        setFocusMode(false);
      }
      // F11 or Ctrl+Shift+F to toggle focus mode
      if (e.key === "F11" || (e.ctrlKey && e.shiftKey && e.key === "F")) {
        e.preventDefault();
        toggleFocusMode();
      }

      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSaveNow();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [focusMode, toggleFocusMode]);

  if (!currentBook) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-muted-foreground">{t("editor.loading")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex h-dvh overflow-hidden ${focusMode ? "focus-mode" : ""}`}>
      {/* Chapter sidebar - hidden in focus mode */}
      {!focusMode && (
        <ChapterList
          chapters={chapters}
          currentChapterId={currentChapter?.id ?? null}
          onSelectChapter={handleSelectChapter}
          onCreateChapter={handleCreateChapter}
          onUpdateChapter={handleUpdateChapter}
          onDeleteChapter={handleDeleteChapter}
          onReorderChapters={handleReorderChapters}
        />
      )}

      {/* Main editor area */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* Header bar - hidden in focus mode */}
        {!focusMode && (
          <div className="h-12 border-b border-border flex items-center px-4 gap-4">
            <button
              onClick={() => navigate("/")}
              className="p-2 hover:bg-muted rounded transition-colors"
              title={t("nav.backToHome")}
            >
              <BackIcon className="w-5 h-5" />
            </button>

            <div className="flex-1">
              <h1 className="font-medium truncate">{currentBook.title}</h1>
              {currentChapter && (
                <p className="text-xs text-muted-foreground truncate">
                  {currentChapter.title}
                </p>
              )}
            </div>

            {/* Save status */}
            <div className="text-sm text-muted-foreground">
              {saveStatus === "saving" && (
                <span className="flex items-center gap-1">
                  <SpinnerIcon className="w-4 h-4 animate-spin" />
                  {t("editor.saving")}
                </span>
              )}
              {saveStatus === "saved" && (
                <span className="flex items-center gap-1 text-success">
                  <CheckIcon className="w-4 h-4" />
                  {t("editor.saved")}
                </span>
              )}
              {!["saving", "saved"].includes(saveStatus) && (
                <button
                  onClick={() => {
                    handleSaveNow();
                  }}
                  disabled={!currentChapter?.content}
                  title={`${t("common.save")} (Ctrl+S)`}
                  className={`p-2 rounded transition-colors text-muted-foreground hover:text-primary`}
                >
                  <SaveIcon className="w-5 h-5" />
                </button>
              )}
            </div>


            {/* Word count */}
            <div className="text-sm text-muted-foreground">
              {wordCount.toLocaleString()} {t("common.words")}
            </div>

            {/* Export button */}
            <button
              onClick={() => setShowExportDialog(true)}
              className="p-2 hover:bg-muted rounded transition-colors"
              title={t("nav.exportBook")}
            >
              <ExportIcon className="w-5 h-5" />
            </button>

            {/* Design Cover button */}
            <button
              onClick={() => navigate(`/book/${bookId}/cover`)}
              className="p-2 hover:bg-muted rounded transition-colors"
              title={t("nav.designCover")}
            >
              <CoverDesignIcon className="w-5 h-5" />
            </button>

            {/* Book Settings button */}
            <button
              onClick={() => setShowSettingsDialog(true)}
              className="p-2 hover:bg-muted rounded transition-colors"
              title={t("bookSettings.title")}
            >
              <SettingsIcon className="w-5 h-5" />
            </button>

            {/** Theme toggle */}
            <ThemeToggle variant="dropdown" />

            {/* Focus mode toggle */}
            <button
              onClick={toggleFocusMode}
              className="p-2 hover:bg-muted rounded transition-colors"
              title={t("nav.focusMode")}
            >
              <FocusModeIcon className="w-5 h-5" />
            </button>
          </div>
        )}

        {/* Editor */}
        {currentChapter ? (
          <Editor
            key={currentChapter.id}
            content={currentChapter.content}
            onUpdate={handleContentUpdate}
            onWordCountChange={handleWordCountChange}
            focusMode={focusMode}
            placeholder={`Start writing "${currentChapter.title}"...`}
          />
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
        {focusMode && (
          <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-black/70 text-white px-4 py-2 rounded-full text-sm opacity-0 hover:opacity-100 transition-opacity">
            {t("editor.press")} <kbd className="px-2 py-0.5 bg-white/20 rounded mx-1">Esc</kbd> {t("editor.or")} <kbd className="px-2 py-0.5 bg-white/20 rounded mx-1">F11</kbd> {t("editor.exitFocus")}
          </div>
        )}
      </div>

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
    </div>
  );
}
