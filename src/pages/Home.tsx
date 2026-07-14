import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { GridList } from "react-aria-components/GridList";
import { useBookStore } from "@/features/books/store";
import { BookCard } from "@/components/project/BookCard";
import { NewBookDialog } from "@/components/project/NewBookDialog";
import { EpubImportDialog } from "@/components/import";
import { Button } from "@/components/ui/Button";
import { useTranslation } from "react-i18next";
import { AddIcon, MaibukLogo } from "@/components/icons";
import { Download, FileUp } from "lucide-react";
import { getDialog, getFileSystem, getWebDialog, IS_WEB } from "@/lib/platform";
import { DOWNLOAD_PAGE } from "@/constants";
import { KeyboardShortcut } from "@/components/ui";
import { isModKey, isTypingTarget } from "@/lib/keyboard";
import { useShortcuts } from "@/lib/shortcuts";
import { scanEpubForImport } from "@/features/import/epub-import-service";
import type { CompatibilityReport, ImportPreview } from "@/features/import";
import { formatKeys, SHORTCUTS, matchKeys } from "@/lib/shortcut-registry";

interface EpubImportState {
  bytes: Uint8Array;
  fileName: string;
  report: CompatibilityReport;
  preview: ImportPreview;
}

export function Home() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [isNewBookOpen, setIsNewBookOpen] = useState(false);
  const [focusedBookId, setFocusedBookId] = useState<string | null>(null);
  const [epubImport, setEpubImport] = useState<EpubImportState | null>(null);
  const [isScanningEpub, setIsScanningEpub] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const { books, isLoading, loadBooks } = useBookStore();
  const gridRef = useRef<HTMLDivElement>(null);
  const previousBookIdsRef = useRef<string[]>([]);
  const activatedBookIdsRef = useRef(new Set<string>());

  const focusBook = useCallback((bookId: string) => {
    const rows = gridRef.current?.querySelectorAll<HTMLElement>("[data-key]");
    const row = [...(rows ?? [])].find((candidate) => candidate.dataset.key === bookId);
    row?.focus();
  }, []);

  const activateBook = useCallback(
    (bookId: string) => {
      if (activatedBookIdsRef.current.has(bookId)) return;
      activatedBookIdsRef.current.add(bookId);
      queueMicrotask(() => activatedBookIdsRef.current.delete(bookId));
      navigate(`/book/${bookId}`);
    },
    [navigate]
  );

  useEffect(() => {
    loadBooks();
  }, [loadBooks]);

  useEffect(() => {
    if (focusedBookId && !books.some((book) => book.id === focusedBookId)) {
      const previousIndex = previousBookIdsRef.current.indexOf(focusedBookId);
      const fallback = books[Math.min(Math.max(previousIndex, 0), books.length - 1)];
      setFocusedBookId(fallback?.id ?? null);
      if (fallback) focusBook(fallback.id);
    }
    previousBookIdsRef.current = books.map((book) => book.id);
  }, [books, focusBook, focusedBookId]);

  useShortcuts([
    {
      keys: matchKeys("home.newBook"),
      onTrigger: (event) => {
        if (isTypingTarget(event.target) || isModKey(event) === false) return;
        setIsNewBookOpen(true);
      },
      allowInInput: true,
    },
    {
      keys: "j",
      onTrigger: () => {
        const activeBookId = (document.activeElement as HTMLElement | null)?.dataset.key;
        const currentIndex = books.findIndex((book) => book.id === activeBookId);
        const targetIndex = currentIndex < 0 ? 0 : Math.min(currentIndex + 1, books.length - 1);
        const target = books[targetIndex];
        if (target) focusBook(target.id);
      },
      enabled: !isNewBookOpen && books.length > 0,
    },
    {
      keys: "k",
      onTrigger: () => {
        const activeBookId = (document.activeElement as HTMLElement | null)?.dataset.key;
        const currentIndex = books.findIndex((book) => book.id === activeBookId);
        const targetIndex = currentIndex < 0 ? books.length - 1 : Math.max(currentIndex - 1, 0);
        const target = books[targetIndex];
        if (target) focusBook(target.id);
      },
      enabled: !isNewBookOpen && books.length > 0,
    },
    ...Array.from({ length: 9 }, (_, i) => ({
      keys: String(i + 1),
      onTrigger: () => {
        const target = books[i];
        if (target) focusBook(target.id);
      },
      enabled: !isNewBookOpen && books.length > 0,
    })),
  ]);

  const handleBookCreated = (bookId: string) => {
    navigate(`/book/${bookId}`);
  };

  const handleImportEpub = async () => {
    setImportError(null);
    setIsScanningEpub(true);
    try {
      let file: { name: string; data: Uint8Array } | null = null;
      if (IS_WEB) {
        const dialog = await getWebDialog();
        file = await dialog.openWithData({
          filters: [{ name: "EPUB", extensions: ["epub"] }],
        });
      } else {
        const dialog = await getDialog();
        const path = await dialog.open({
          filters: [{ name: "EPUB", extensions: ["epub"] }],
        });
        if (path) {
          const fs = await getFileSystem();
          file = { name: path.split("/").pop() ?? path, data: await fs.readFile(path) };
        }
      }

      if (!file) return;

      const scan = await scanEpubForImport(file.data);
      setEpubImport({
        bytes: file.data,
        fileName: file.name,
        report: scan.report,
        preview: scan.preview,
      });
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsScanningEpub(false);
    }
  };

  const handleBookImported = (bookId: string) => {
    navigate(`/book/${bookId}`);
  };

  if (isLoading && books.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground">{t("books.loading")}</div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8 overflow-auto h-full">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 sm:mb-8">
        <h1 data-route-heading className="text-xl sm:text-2xl font-semibold">{t("books.title")}</h1>
        <div className="flex items-center gap-2">
          {IS_WEB && (
            <Button
              variant="secondary"
              onClick={() => window.open(DOWNLOAD_PAGE, "_blank")}
              className="text-sm"
            >
              <Download className="w-5 h-5" />
              <span className="hidden sm:inline">{t("nav.downloadApp")}</span>
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={handleImportEpub}
            className="text-sm"
            disabled={isScanningEpub}
          >
            <FileUp className="w-5 h-5" />
            <span className="hidden sm:inline">
              {isScanningEpub ? t("import.scanning") : t("books.importEpub")}
            </span>
            <span className="sm:hidden">{t("books.importShort")}</span>
          </Button>
          <Button onClick={() => setIsNewBookOpen(true)} className="text-sm">
            <AddIcon className="w-5 h-5" />
            <span className="hidden sm:inline">{t("books.newBook")}</span>
            <span className="sm:hidden">{t("common.new")}</span>
            <KeyboardShortcut
              shortcut={formatKeys(SHORTCUTS["home.newBook"])}
              className="hidden lg:inline-flex"
            />
          </Button>
        </div>
      </div>

      {books.length === 0 ? (
        /* Empty state */
        <div className="empty-state-enter flex flex-col items-center justify-center py-20 sm:py-28 text-center">
          <div className="w-20 h-20 mb-8">
            <MaibukLogo className="w-full h-full text-primary opacity-70" />
          </div>
          <h3 className="text-2xl sm:text-3xl font-semibold mb-3 tracking-tight">
            {t("books.noBooks")}
          </h3>
          <p className="text-muted-foreground mb-8 max-w-sm leading-relaxed">
            {t("books.noBooksFull")}
          </p>
          <Button size="lg" onClick={() => setIsNewBookOpen(true)}>
            <AddIcon className="w-5 h-5" />
            {t("books.noBooksButton")}
          </Button>
        </div>
      ) : (
        /* Book grid */
        <div
          onFocusCapture={(event) => {
            const row = (event.target as HTMLElement).closest<HTMLElement>("[data-key]");
            if (row?.dataset.key) setFocusedBookId(row.dataset.key);
          }}
        >
          <GridList
            ref={gridRef}
            aria-label={t("books.collectionLabel")}
            items={books}
            layout="grid"
            selectionMode="none"
            onAction={(key) => activateBook(String(key))}
            className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6"
          >
            {(book) => (
              <BookCard
                book={book}
                index={books.findIndex((candidate) => candidate.id === book.id)}
                onPress={() => activateBook(book.id)}
              />
            )}
          </GridList>
        </div>
      )}

      {importError && (
        <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:max-w-md rounded-lg border border-destructive/30 bg-background px-4 py-3 text-sm text-destructive shadow-lg">
          {importError}
        </div>
      )}

      <NewBookDialog
        isOpen={isNewBookOpen}
        onClose={() => setIsNewBookOpen(false)}
        onSuccess={handleBookCreated}
      />
      {epubImport && (
        <EpubImportDialog
          isOpen={true}
          bytes={epubImport.bytes}
          fileName={epubImport.fileName}
          report={epubImport.report}
          preview={epubImport.preview}
          onClose={() => setEpubImport(null)}
          onImported={handleBookImported}
        />
      )}
    </div>
  );
}
