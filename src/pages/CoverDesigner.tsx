import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { IS_WEB, getDialog, getFileSystem } from "@/lib/platform";
import { CanvasStage, LayersPanel, PropertiesPanel, Toolbar } from "@/components/cover-editor";
import type { ExportChoice } from "@/components/cover-editor/Toolbar";
import { useBookStore } from "@/features/books/store";
import { useCoverStore } from "@/features/covers/store";
import { createDefaultScene, createTextLayer } from "@/features/covers/scene/defaults";
import { loadScene } from "@/features/covers/scene/migrate";
import { dataUrlToBytes, exportScene, exportScenePdf } from "@/features/covers/export";
import { Button } from "@/components/ui/Button";
import { BackIcon } from "@/components/icons";
import { useShortcuts } from "@/lib/shortcuts";
import { matchKeys } from "@/lib/shortcut-registry";

const DEFAULT_PRESET = "6x9";

export function CoverDesigner() {
  const { t } = useTranslation();
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();

  const { currentBook, loadBook, updateBook } = useBookStore();
  const dirty = useCoverStore((s) => s.dirty);
  const [isSaving, setIsSaving] = useState(false);
  const coverLoadedRef = useRef(false);

  useEffect(() => {
    if (bookId) loadBook(bookId);
  }, [bookId, loadBook]);

  // Load (and migrate) the cover scene once the book is available.
  useEffect(() => {
    if (!currentBook || coverLoadedRef.current) return;
    coverLoadedRef.current = true;
    const store = useCoverStore.getState();
    const fallbackDoc = createDefaultScene(DEFAULT_PRESET).doc;
    const scene = loadScene(currentBook.coverData, fallbackDoc);

    if (!currentBook.coverData && scene.layers.length === 0) {
      // Seed a fresh cover from the book metadata.
      store.setScene(scene);
      store.addLayer(
        createTextLayer({
          role: "title",
          text: currentBook.title,
          docWidth: scene.doc.width,
          docHeight: scene.doc.height,
        })
      );
      store.addLayer(
        createTextLayer({
          role: "author",
          text: currentBook.authorName,
          docWidth: scene.doc.width,
          docHeight: scene.doc.height,
        })
      );
      store.markSaved();
    } else {
      store.setScene(scene);
    }
  }, [currentBook]);

  const exportAndSave = useCallback(
    async (format: ExportChoice) => {
      const scene = useCoverStore.getState().scene;
      let bytes: Uint8Array;
      let ext: string;
      let mimeType: string;
      if (format === "pdf") {
        bytes = await exportScenePdf(scene);
        ext = "pdf";
        mimeType = "application/pdf";
      } else {
        const dataUrl = await exportScene(scene, { format, targetDpi: scene.doc.dpi });
        bytes = dataUrlToBytes(dataUrl);
        ext = format === "jpeg" ? "jpg" : "png";
        mimeType = format === "png" ? "image/png" : "image/jpeg";
      }
      const filename = `${currentBook?.title || "cover"}.${ext}`;

      if (IS_WEB) {
        const fs = await getFileSystem();
        fs.downloadFile(filename, bytes, mimeType);
        return;
      }
      const dialog = await getDialog();
      const filePath = await dialog.save({
        defaultPath: filename,
        filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
      });
      if (filePath) {
        const fs = await getFileSystem();
        await fs.writeFile(filePath, bytes);
      }
    },
    [currentBook?.title]
  );

  const handleSave = useCallback(async () => {
    if (!bookId) return;
    setIsSaving(true);
    try {
      const scene = useCoverStore.getState().scene;
      const coverData = JSON.stringify(scene);
      const coverImagePath = await exportScene(scene, { format: "png", targetDpi: scene.doc.dpi });
      await updateBook(bookId, { coverData, coverImagePath });
      useCoverStore.getState().markSaved();
    } catch (error) {
      console.error("Failed to save cover:", error);
    } finally {
      setIsSaving(false);
    }
  }, [bookId, updateBook]);

  const handleBack = useCallback(() => {
    navigate(`/book/${bookId}`);
  }, [navigate, bookId]);

  useShortcuts([
    {
      keys: ["delete", "backspace"],
      onTrigger: () => {
        const { selectedId, removeLayer } = useCoverStore.getState();
        if (selectedId) removeLayer(selectedId);
      },
    },
    { keys: matchKeys("cover.save"), onTrigger: () => handleSave(), allowInInput: true },
    { keys: ["ctrl+z", "meta+z"], onTrigger: () => useCoverStore.getState().undo() },
    {
      keys: ["ctrl+shift+z", "meta+shift+z", "ctrl+y"],
      onTrigger: () => useCoverStore.getState().redo(),
    },
    {
      keys: matchKeys("cover.duplicate"),
      onTrigger: () => useCoverStore.getState().duplicateSelected(),
      preventDefault: true,
    },
    { keys: ["arrowup"], onTrigger: () => useCoverStore.getState().nudgeSelected(0, -1) },
    { keys: ["arrowdown"], onTrigger: () => useCoverStore.getState().nudgeSelected(0, 1) },
    { keys: ["arrowleft"], onTrigger: () => useCoverStore.getState().nudgeSelected(-1, 0) },
    { keys: ["arrowright"], onTrigger: () => useCoverStore.getState().nudgeSelected(1, 0) },
    { keys: ["shift+arrowup"], onTrigger: () => useCoverStore.getState().nudgeSelected(0, -10) },
    { keys: ["shift+arrowdown"], onTrigger: () => useCoverStore.getState().nudgeSelected(0, 10) },
    { keys: ["shift+arrowleft"], onTrigger: () => useCoverStore.getState().nudgeSelected(-10, 0) },
    { keys: ["shift+arrowright"], onTrigger: () => useCoverStore.getState().nudgeSelected(10, 0) },
    {
      keys: ["["],
      onTrigger: () => {
        const { selectedId, sendBackward } = useCoverStore.getState();
        if (selectedId) sendBackward(selectedId);
      },
    },
    {
      keys: ["]"],
      onTrigger: () => {
        const { selectedId, bringForward } = useCoverStore.getState();
        if (selectedId) bringForward(selectedId);
      },
    },
    { keys: ["escape"], onTrigger: () => useCoverStore.getState().select(null) },
  ]);

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
          disabled={!dirty || isSaving}
          className="text-xs sm:text-sm"
        >
          {isSaving ? t("common.loading") : dirty ? t("cover.saveCover") : t("cover.saved")}
        </Button>
      </div>

      {/* Toolbar */}
      <Toolbar
        onExport={exportAndSave}
        bookTitle={currentBook.title}
        bookAuthor={currentBook.authorName}
      />

      {/* Main area: layers | canvas | properties */}
      <div className="flex-1 flex min-h-0">
        <div className="w-56 border-r border-border hidden md:block">
          <LayersPanel />
        </div>
        <CanvasStage className="flex-1" />
        <div className="w-64 border-l border-border overflow-y-auto hidden lg:block">
          <PropertiesPanel />
        </div>
      </div>
    </div>
  );
}
