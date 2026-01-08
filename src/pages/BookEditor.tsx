import { useParams, useNavigate } from "react-router-dom";
import { useEffect, useState, useCallback } from "react";
import { useBookStore } from "../features/books/store";
import { useChapterStore } from "../features/chapters/store";
import type { Chapter, ChapterType } from "../features/chapters/types";
import { Editor, ChapterList } from "../components/editor";
import { useDebouncedCallback } from "../hooks/useAutoSave";

export function BookEditor() {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();

  // Stores
  const { currentBook, loadBook, updateWordCount } = useBookStore();
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
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "idle">("idle");

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

  // Update word count display when chapter changes
  useEffect(() => {
    if (currentChapter) {
      setWordCount(currentChapter.wordCount);
    }
  }, [currentChapter?.id]);

  // Calculate total book word count when chapters change
  useEffect(() => {
    if (bookId && chapters.length > 0) {
      const totalWords = chapters.reduce((sum, c) => sum + c.wordCount, 0);
      updateWordCount(bookId, totalWords);
    }
  }, [bookId, chapters, updateWordCount]);

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

  // Toggle focus mode
  const toggleFocusMode = useCallback(() => {
    setFocusMode((prev) => !prev);
  }, []);

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
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [focusMode, toggleFocusMode]);

  if (!currentBook) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-muted-foreground">Loading book...</p>
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
              title="Back to Home"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
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
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Saving...
                </span>
              )}
              {saveStatus === "saved" && (
                <span className="flex items-center gap-1 text-success">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Saved
                </span>
              )}
            </div>

            {/* Word count */}
            <div className="text-sm text-muted-foreground">
              {wordCount.toLocaleString()} words
            </div>

            {/* Design Cover button */}
            <button
              onClick={() => navigate(`/book/${bookId}/cover`)}
              className="p-2 hover:bg-muted rounded transition-colors"
              title="Design Cover"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </button>

            {/* Focus mode toggle */}
            <button
              onClick={toggleFocusMode}
              className="p-2 hover:bg-muted rounded transition-colors"
              title="Focus Mode (F11)"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
              </svg>
            </button>
          </div>
        )}

        {/* Editor */}
        {currentChapter ? (
          <Editor
            content={currentChapter.content}
            onUpdate={handleContentUpdate}
            onWordCountChange={handleWordCountChange}
            focusMode={focusMode}
            placeholder={`Start writing "${currentChapter.title}"...`}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-muted-foreground">
              <svg className="w-16 h-16 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-lg mb-2">No chapter selected</p>
              <p className="text-sm">Create a new chapter to start writing</p>
            </div>
          </div>
        )}

        {/* Focus mode exit hint */}
        {focusMode && (
          <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-black/70 text-white px-4 py-2 rounded-full text-sm opacity-0 hover:opacity-100 transition-opacity">
            Press <kbd className="px-2 py-0.5 bg-white/20 rounded mx-1">Esc</kbd> or <kbd className="px-2 py-0.5 bg-white/20 rounded mx-1">F11</kbd> to exit focus mode
          </div>
        )}
      </div>
    </div>
  );
}
