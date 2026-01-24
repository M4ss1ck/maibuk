import { useState, useRef, useCallback, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { IS_WEB, getDialog, getFileSystem } from "../lib/platform";
import { CoverCanvas, CoverToolbar, type CoverCanvasRef } from "../components/cover-editor";
import { useBookStore } from "../features/books/store";
import { COVER_DIMENSIONS, DEFAULT_TEXT_STYLES, type CoverDimension, type TextStyle } from "../features/covers/types";
import { Button } from "../components/ui/Button";
import { useTranslation } from "react-i18next";
import { BackIcon } from "../components/icons";

export function CoverDesigner() {
  const { t } = useTranslation();
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

    const filename = `${currentBook?.title || "cover"}.${format}`;
    const mimeType = format === "png" ? "image/png" : "image/jpeg";

    if (IS_WEB) {
      // On web, directly download the file
      const fs = await getFileSystem();
      fs.downloadFile(filename, bytes, mimeType);
    } else {
      // On Tauri, show save dialog
      const dialog = await getDialog();
      const filePath = await dialog.save({
        defaultPath: filename,
        filters: [
          {
            name: format.toUpperCase(),
            extensions: [format],
          },
        ],
      });

      if (filePath) {
        const fs = await getFileSystem();
        await fs.writeFile(filePath, bytes);
      }
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
          <p className="text-muted-foreground">{t("common.loading")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-dvh">
      {/* Header */}
      <div className="h-12 border-b border-border flex items-center px-2 sm:px-4 gap-2 sm:gap-4">
        <Button variant="ghost" size="sm" onClick={handleBack}>
          <BackIcon className="w-5 h-5" />
        </Button>

        <div className="flex-1 min-w-0">
          <h1 className="font-medium text-sm sm:text-base truncate">{t("cover.title")}</h1>
          <p className="text-xs text-muted-foreground truncate">{currentBook.title}</p>
        </div>

        <Button
          variant="secondary"
          size="sm"
          onClick={handleSave}
          disabled={!hasChanges || isSaving}
          className="text-xs sm:text-sm"
        >
          {isSaving ? t("common.loading") : hasChanges ? t("cover.saveCover") : t("cover.saved")}
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

      {/* Tips - hidden on mobile */}
      <div className="hidden sm:flex h-10 border-t border-border items-center justify-center text-sm text-muted-foreground gap-4">
        <span>{t("cover.tips.doubleClick")}</span>
        <span>|</span>
        <span>{t("cover.tips.delete")}</span>
        <span>|</span>
        <span>{t("cover.tips.save")}</span>
      </div>
    </div>
  );
}
