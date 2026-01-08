import { useState, useRef, useCallback, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { CoverCanvas, CoverToolbar, type CoverCanvasRef } from "../components/cover-editor";
import { useBookStore } from "../features/books/store";
import { COVER_DIMENSIONS, DEFAULT_TEXT_STYLES, type CoverDimension, type TextStyle } from "../features/covers/types";
import { Button } from "../components/ui/Button";

export function CoverDesigner() {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const canvasRef = useRef<CoverCanvasRef>(null);

  const { currentBook, loadBook, updateBook } = useBookStore();

  const [dimension, setDimension] = useState<CoverDimension>(COVER_DIMENSIONS[0]);
  const [hasSelection, setHasSelection] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [isCanvasReady, setIsCanvasReady] = useState(false);
  const coverLoadedRef = useRef(false);

  // Load book data
  useEffect(() => {
    if (bookId) {
      loadBook(bookId);
    }
  }, [bookId, loadBook]);

  // Handle canvas ready - load cover data
  const handleCanvasReady = useCallback(() => {
    setIsCanvasReady(true);
  }, []);

  // Load existing cover data OR initialize with book title and author
  useEffect(() => {
    if (!canvasRef.current || !currentBook || !isCanvasReady || coverLoadedRef.current) return;

    // Mark as loaded to prevent re-loading
    coverLoadedRef.current = true;

    if (currentBook.coverData) {
      // Load existing cover
      canvasRef.current.loadJSON(currentBook.coverData);
      setHasChanges(false);
    } else {
      // Initialize new cover with book title and author
      const { title, authorName } = currentBook;

      // Add title
      canvasRef.current.addText(
        title,
        DEFAULT_TEXT_STYLES.title,
        "title"
      );

      // Add author name below title
      const authorStyle = {
        ...DEFAULT_TEXT_STYLES.author,
      };
      canvasRef.current.addText(
        authorName,
        authorStyle,
        "author"
      );

      // Don't mark as having changes for initial setup
      setTimeout(() => setHasChanges(false), 100);
    }
  }, [currentBook, isCanvasReady]);

  const handleSelectionChange = useCallback((selected: boolean) => {
    setHasSelection(selected);
  }, []);

  const handleModified = useCallback(() => {
    setHasChanges(true);
  }, []);

  const handleAddText = useCallback((text: string, style: TextStyle, type: string) => {
    canvasRef.current?.addText(text, style, type);
  }, []);

  const handleAddImage = useCallback(async (file: File) => {
    const url = URL.createObjectURL(file);
    await canvasRef.current?.addImage(url);
  }, []);

  const handleBackgroundColor = useCallback((color: string) => {
    canvasRef.current?.setBackgroundColor(color);
  }, []);

  const handleBackgroundImage = useCallback(async (file: File) => {
    const url = URL.createObjectURL(file);
    await canvasRef.current?.setBackgroundImage(url);
  }, []);

  const handleDelete = useCallback(() => {
    canvasRef.current?.deleteSelected();
  }, []);

  const handleBringForward = useCallback(() => {
    canvasRef.current?.bringForward();
  }, []);

  const handleSendBackward = useCallback(() => {
    canvasRef.current?.sendBackward();
  }, []);

  const handleExport = useCallback(async (format: "png" | "jpeg") => {
    if (!canvasRef.current) return;

    const dataUrl = format === "png"
      ? canvasRef.current.exportToPNG()
      : canvasRef.current.exportToJPEG(0.9);

    // Convert data URL to binary
    const base64 = dataUrl.split(",")[1];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    // Open save dialog
    const filePath = await save({
      defaultPath: `${currentBook?.title || "cover"}.${format}`,
      filters: [
        {
          name: format.toUpperCase(),
          extensions: [format],
        },
      ],
    });

    if (filePath) {
      await writeFile(filePath, bytes);
    }
  }, [currentBook?.title]);

  const handleSave = useCallback(async () => {
    if (!bookId || !canvasRef.current) return;

    setIsSaving(true);
    try {
      const coverData = canvasRef.current.getJSON();
      const coverImagePath = canvasRef.current.exportToPNG();

      await updateBook(bookId, {
        coverData,
        coverImagePath,
      });

      setHasChanges(false);
    } catch (error) {
      console.error("Failed to save cover:", error);
    } finally {
      setIsSaving(false);
    }
  }, [bookId, updateBook]);

  const handleBack = useCallback(() => {
    if (hasChanges) {
      // TODO: Show confirmation dialog
    }
    navigate(`/book/${bookId}`);
  }, [navigate, bookId, hasChanges]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Delete selected
      if (e.key === "Delete" || e.key === "Backspace") {
        if (document.activeElement?.tagName !== "INPUT") {
          handleDelete();
        }
      }
      // Save
      if (e.ctrlKey && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleDelete, handleSave]);

  if (!currentBook) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-dvh">
      {/* Header */}
      <div className="h-12 border-b border-border flex items-center px-4 gap-4">
        <Button variant="ghost" size="sm" onClick={handleBack}>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
        </Button>

        <div className="flex-1">
          <h1 className="font-medium">Cover Designer</h1>
          <p className="text-xs text-muted-foreground">{currentBook.title}</p>
        </div>

        <Button
          variant="secondary"
          size="sm"
          onClick={handleSave}
          disabled={!hasChanges || isSaving}
        >
          {isSaving ? "Saving..." : hasChanges ? "Save Cover" : "Saved"}
        </Button>
      </div>

      {/* Toolbar */}
      <CoverToolbar
        dimension={dimension}
        onDimensionChange={setDimension}
        onAddText={handleAddText}
        onAddImage={handleAddImage}
        onBackgroundColor={handleBackgroundColor}
        onBackgroundImage={handleBackgroundImage}
        onDelete={handleDelete}
        onBringForward={handleBringForward}
        onSendBackward={handleSendBackward}
        onExport={handleExport}
        hasSelection={hasSelection}
        bookTitle={currentBook.title}
        bookAuthor={currentBook.authorName}
      />

      {/* Canvas area */}
      <CoverCanvas
        ref={canvasRef}
        dimension={dimension}
        onSelectionChange={handleSelectionChange}
        onModified={handleModified}
        onCanvasReady={handleCanvasReady}
        className="flex-1"
      />

      {/* Tips */}
      <div className="h-10 border-t border-border flex items-center justify-center text-sm text-muted-foreground gap-4">
        <span>Double-click text to edit</span>
        <span>|</span>
        <span>Delete: Remove selected</span>
        <span>|</span>
        <span>Ctrl+S: Save</span>
      </div>
    </div>
  );
}
