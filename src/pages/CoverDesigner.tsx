import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Layers, SlidersHorizontal } from "lucide-react";
import { IS_WEB, getDialog, getFileSystem } from "@/lib/platform";
import { CanvasStage, LayersPanel, PropertiesPanel, Toolbar } from "@/components/cover-editor";
import type { ExportChoice } from "@/components/cover-editor/Toolbar";
import { useBookStore } from "@/features/books/store";
import { useCoverStore } from "@/features/covers/store";
import { createDefaultScene, createTextLayer } from "@/features/covers/scene/defaults";
import { loadScene } from "@/features/covers/scene/migrate";
import { dataUrlToBytes, exportScene, exportScenePdf } from "@/features/covers/export";
import { Button, Modal } from "@/components/ui";
import { CommandPaletteButton } from "@/components/command-palette/CommandPaletteButton";
import { BackIcon } from "@/components/icons";
import { useShortcuts } from "@/lib/shortcuts";

const DEFAULT_PRESET = "6x9";

/** Whether the Layers sidebar is docked (`md:` breakpoint). Below it Layers
 * is a sheet, so the sidebar footer (and its palette button) is not rendered
 * and the toolbar carries the entry point instead. */
const WIDE_LAYERS_QUERY = "(min-width: 768px)";

function useWideLayers(): boolean {
  const [wide, setWide] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(WIDE_LAYERS_QUERY).matches
      : true
  );
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(WIDE_LAYERS_QUERY);
    const onChange = (event: MediaQueryListEvent) => setWide(event.matches);
    query.addEventListener("change", onChange);
    setWide(query.matches);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return wide;
}

export function CoverDesigner() {
  const { t } = useTranslation();
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();

  const { currentBook, loadBook, updateBook } = useBookStore();
  const dirty = useCoverStore((s) => s.dirty);
  const [isSaving, setIsSaving] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [propsOpen, setPropsOpen] = useState(false);
  const wideLayers = useWideLayers();
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
      id: "common.delete",
      onTrigger: () => {
        const { selectedId, removeLayer } = useCoverStore.getState();
        if (selectedId) removeLayer(selectedId);
      },
    },
    {
      id: "common.save",
      onTrigger: () => handleSave(),
      allowInInput: true,
    },
    {
      id: "common.undo",
      onTrigger: () => useCoverStore.getState().undo(),
    },
    {
      id: "common.redo",
      onTrigger: () => useCoverStore.getState().redo(),
    },
    {
      id: "coverDesigner.duplicate",
      onTrigger: () => useCoverStore.getState().duplicateSelected(),
      preventDefault: true,
    },
    {
      id: "coverDesigner.nudgeUp",
      onTrigger: () => useCoverStore.getState().nudgeSelected(0, -1),
    },
    {
      id: "coverDesigner.nudgeDown",
      onTrigger: () => useCoverStore.getState().nudgeSelected(0, 1),
    },
    {
      id: "coverDesigner.nudgeLeft",
      onTrigger: () => useCoverStore.getState().nudgeSelected(-1, 0),
    },
    {
      id: "coverDesigner.nudgeRight",
      onTrigger: () => useCoverStore.getState().nudgeSelected(1, 0),
    },
    {
      id: "coverDesigner.nudgeUpFar",
      onTrigger: () => useCoverStore.getState().nudgeSelected(0, -10),
    },
    {
      id: "coverDesigner.nudgeDownFar",
      onTrigger: () => useCoverStore.getState().nudgeSelected(0, 10),
    },
    {
      id: "coverDesigner.nudgeLeftFar",
      onTrigger: () => useCoverStore.getState().nudgeSelected(-10, 0),
    },
    {
      id: "coverDesigner.nudgeRightFar",
      onTrigger: () => useCoverStore.getState().nudgeSelected(10, 0),
    },
    {
      id: "coverDesigner.sendBackward",
      onTrigger: () => {
        const { selectedId, sendBackward } = useCoverStore.getState();
        if (selectedId) sendBackward(selectedId);
      },
    },
    {
      id: "coverDesigner.bringForward",
      onTrigger: () => {
        const { selectedId, bringForward } = useCoverStore.getState();
        if (selectedId) bringForward(selectedId);
      },
    },
    {
      id: "coverDesigner.clearSelection",
      onTrigger: () => useCoverStore.getState().select(null),
    },
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
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="h-12 border-b border-border flex items-center px-2 sm:px-4 gap-2 sm:gap-4">
        <Button variant="ghost" size="sm" onClick={handleBack} aria-label={t("common.back")}>
          <BackIcon className="w-5 h-5" aria-hidden="true" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 data-route-heading className="font-medium text-sm sm:text-base truncate">
            {t("cover.title")}
          </h1>
          <p className="text-xs text-muted-foreground truncate">{currentBook.title}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="md:hidden"
          onClick={() => setLayersOpen(true)}
          aria-label={t("cover.layers.title")}
        >
          <Layers className="w-4 h-4" aria-hidden="true" />
          <span className="hidden sm:inline">{t("cover.layers.title")}</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="lg:hidden"
          onClick={() => setPropsOpen(true)}
          aria-label={t("cover.props.title")}
        >
          <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
          <span className="hidden sm:inline">{t("cover.props.title")}</span>
        </Button>
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
        trailing={!wideLayers ? <CommandPaletteButton size="sm" /> : undefined}
      />

      {/* Main area: layers | canvas | properties */}
      <main className="flex-1 flex min-h-0">
        <div className="w-56 border-r border-border hidden md:flex md:flex-col">
          <div className="flex-1 min-h-0">
            <LayersPanel />
          </div>
          {wideLayers && (
            <div className="flex items-center gap-2 border-t border-border p-2">
              <span className="flex-1" />
              <CommandPaletteButton size="sm" />
            </div>
          )}
        </div>
        <CanvasStage className="flex-1" />
        <div className="w-64 border-l border-border overflow-y-auto hidden lg:block">
          <PropertiesPanel />
        </div>
      </main>

      <Modal
        isOpen={layersOpen}
        onClose={() => setLayersOpen(false)}
        title={t("cover.layers.title")}
      >
        <div data-testid="cover-layers-sheet">
          <LayersPanel />
        </div>
      </Modal>
      <Modal isOpen={propsOpen} onClose={() => setPropsOpen(false)} title={t("cover.props.title")}>
        <div data-testid="cover-properties-sheet">
          <PropertiesPanel />
        </div>
      </Modal>
    </div>
  );
}
