import {
  lazy,
  Suspense,
  useState,
  useEffect,
  useCallback,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { GridList, GridListItem } from "react-aria-components/GridList";
import {
  keepFocusRestoreInRowForm,
  keepRowFromActing,
  keepTabInRowForm,
} from "@/lib/arrow-navigation";
import {
  Eye,
  GitCompareArrows,
  RotateCcw,
  Pencil,
  Trash2,
  ArrowLeft,
  Check,
  X,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { toast } from "@/components/ui/Toast";
import { Tooltip, TooltipGroup } from "@/components/ui";
import { useVersionStore, DEFAULT_VERSIONS_PAGE_SIZE } from "@/features/versions/store";
import type { BookVersion } from "@/features/versions/types";
import type { BookSnapshot } from "@/features/sync/types";
import { serializeBook } from "@/features/sync/serializer";
import { VersionPreview } from "@/components/versions/VersionPreview";

const VersionCompare = lazy(() =>
  import("@/components/versions/VersionCompare").then((module) => ({
    default: module.VersionCompare,
  }))
);

interface VersionPanelProps {
  isOpen: boolean;
  onClose: () => void;
  bookId: string;
  flushBeforeCompare: () => Promise<void>;
}

function formatRelativeTime(date: Date, locale: string): string {
  try {
    const now = Date.now();
    const diffMs = now - date.getTime();
    const diffSec = Math.round(diffMs / 1000);
    const diffMin = Math.round(diffSec / 60);
    const diffHour = Math.round(diffMin / 60);
    const diffDay = Math.round(diffHour / 24);

    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    if (diffDay > 0) return rtf.format(-diffDay, "day");
    if (diffHour > 0) return rtf.format(-diffHour, "hour");
    if (diffMin > 0) return rtf.format(-diffMin, "minute");
    return rtf.format(-diffSec, "second");
  } catch {
    return date.toLocaleString(locale);
  }
}

type ConfirmAction = { type: "restore" | "delete"; versionId: string } | null;

export function VersionPanel({ isOpen, onClose, bookId, flushBeforeCompare }: VersionPanelProps) {
  const { t, i18n } = useTranslation();
  const visibleVersions = useVersionStore((state) => state.versions);
  const totalCount = useVersionStore((state) => state.totalCount);
  const currentPage = useVersionStore((state) => state.currentPage);
  const pageSize = useVersionStore((state) => state.pageSize);
  const isLoading = useVersionStore((state) => state.isLoading);
  const loadVersions = useVersionStore((state) => state.loadVersions);
  const setPage = useVersionStore((state) => state.setPage);
  const getVersionSnapshot = useVersionStore((state) => state.getVersionSnapshot);
  const restoreVersion = useVersionStore((state) => state.restoreVersion);
  const renameVersion = useVersionStore((state) => state.renameVersion);
  const deleteVersion = useVersionStore((state) => state.deleteVersion);

  const [compare, setCompare] = useState<{
    current: BookSnapshot;
    target: BookSnapshot;
  } | null>(null);
  const [previewSnapshot, setPreviewSnapshot] = useState<BookSnapshot | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      loadVersions(bookId, 1, DEFAULT_VERSIONS_PAGE_SIZE);
      setCompare(null);
      setPreviewSnapshot(null);
      setFocusedIndex(0);
      setRenamingId(null);
      setConfirmAction(null);
    }
  }, [isOpen, bookId, loadVersions]);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const goToPage = useCallback(
    (page: number) => {
      const clamped = Math.min(Math.max(1, page), totalPages);
      if (clamped === currentPage) return;
      setFocusedIndex(0);
      setConfirmAction(null);
      setRenamingId(null);
      void setPage(clamped);
    },
    [setPage, totalPages, currentPage]
  );

  // The GridList owns roving focus (ADR 0025), so a row is addressed by its
  // Version id through the list ref rather than a hand-written DOM id.
  const rowElement = useCallback(
    (index: number): HTMLElement | null => {
      const id = visibleVersions[index]?.id;
      if (!id) return null;
      return (
        Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="row"]') ?? []).find(
          (el) => el.dataset.key === id
        ) ?? null
      );
    },
    [visibleVersions]
  );

  const focusRow = useCallback(
    (index: number) => {
      // React Aria renders a GridList's rows one commit after the list mounts,
      // so a row addressable only next frame is looked up then (ChapterList's
      // focusChapterRow follows the same rule).
      requestAnimationFrame(() => {
        rowElement(index)?.focus();
      });
    },
    [rowElement]
  );

  // A restore or delete removes the confirm, and the row with it, from under
  // focus; once the list has re-rendered without it, focus goes to this row.
  const pendingRowFocus = useRef<number | null>(null);
  useEffect(() => {
    if (pendingRowFocus.current === null || confirmAction || visibleVersions.length === 0) return;
    const index = Math.min(pendingRowFocus.current, visibleVersions.length - 1);
    pendingRowFocus.current = null;
    setFocusedIndex(index);
    focusRow(index);
  }, [confirmAction, visibleVersions, focusRow]);

  // Closes the inline confirm and hands focus back to the Version row it was
  // opened from, so the keyboard stays on the row the author was acting on.
  const cancelConfirm = useCallback(() => {
    setConfirmAction(null);
    focusRow(focusedIndex);
  }, [focusRow, focusedIndex]);

  const handlePreview = useCallback(
    async (version: BookVersion) => {
      try {
        const snapshot = JSON.parse(await getVersionSnapshot(version.id)) as BookSnapshot;
        setPreviewSnapshot(snapshot);
      } catch {
        toast.error(t("common.error"));
      }
    },
    [getVersionSnapshot, t]
  );

  const handleCompare = useCallback(
    async (version: BookVersion) => {
      try {
        await flushBeforeCompare();
        const currentJson = await serializeBook(bookId);
        const current = JSON.parse(currentJson) as BookSnapshot;
        const target = JSON.parse(await getVersionSnapshot(version.id)) as BookSnapshot;
        setCompare({ current, target });
      } catch {
        toast.error(t("common.error"));
      }
    },
    [bookId, flushBeforeCompare, getVersionSnapshot, t]
  );

  const handleRestore = useCallback(
    async (version: BookVersion) => {
      try {
        const displayName = version.name ?? t("versions.autoCheckpoint");
        await restoreVersion(version.id, {
          preRestoreName: t("versions.restoredName", { name: displayName }),
        });
        toast.success(t("versions.restoreSuccess"));
        // The reloaded list opens with the pre-restore Checkpoint on top.
        pendingRowFocus.current = 0;
        setConfirmAction(null);
      } catch {
        toast.error(t("common.error"));
      }
    },
    [restoreVersion, t]
  );

  const handleDelete = useCallback(
    async (versionId: string) => {
      try {
        await deleteVersion(versionId);
        // The next Version slides into the deleted row's place.
        pendingRowFocus.current = focusedIndex;
        setConfirmAction(null);
      } catch {
        toast.error(t("common.error"));
      }
    },
    [deleteVersion, focusedIndex, t]
  );

  const startRename = useCallback((version: BookVersion) => {
    setRenamingId(version.id);
    setRenameValue(version.name ?? "");
  }, []);

  const handleRename = useCallback(
    async (versionId: string) => {
      try {
        await renameVersion(versionId, renameValue);
        setRenamingId(null);
      } catch {
        toast.error(t("common.error"));
      }
    },
    [renameVersion, renameValue, t]
  );

  // Row buttons stop Enter and Space from running the row (keepRowFromActing).
  // The inline rename and confirm are small forms: Tab moves between their
  // controls instead of out of the list (keepTabInRowForm).
  const routeRowFormKeys = (event: ReactKeyboardEvent<HTMLElement>) => {
    keepRowFromActing(event);
    keepTabInRowForm(event);
  };
  // The click a button's Enter produces, and a mouse click, would bubble to the
  // row as well (CanvasCard's stopRowActionClick).
  const keepRowFromClick = (event: ReactMouseEvent<HTMLElement>) => event.stopPropagation();

  // Keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return;

    const handler = (e: KeyboardEvent) => {
      if (previewSnapshot) {
        if (e.key === "Escape") {
          e.preventDefault();
          setPreviewSnapshot(null);
        }
        return;
      }
      if (compare) {
        if (e.key === "Escape") {
          e.preventDefault();
          setCompare(null);
        }
        return;
      }

      if (renamingId) {
        if (e.key === "Escape") {
          e.preventDefault();
          setRenamingId(null);
        }
        return;
      }

      switch (e.key) {
        case "PageDown":
          if (currentPage < totalPages) {
            e.preventDefault();
            goToPage(currentPage + 1);
          }
          break;
        case "PageUp":
          if (currentPage > 1) {
            e.preventDefault();
            goToPage(currentPage - 1);
          }
          break;
        case "r":
        case "R": {
          e.preventDefault();
          const v = visibleVersions[focusedIndex];
          if (v) setConfirmAction({ type: "restore", versionId: v.id });
          break;
        }
        case "Delete": {
          e.preventDefault();
          const v = visibleVersions[focusedIndex];
          if (v) setConfirmAction({ type: "delete", versionId: v.id });
          break;
        }
        case "F2": {
          e.preventDefault();
          const v = visibleVersions[focusedIndex];
          if (v) startRename(v);
          break;
        }
        case "Escape":
          if (confirmAction) {
            e.preventDefault();
            cancelConfirm();
          }
          break;
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [
    isOpen,
    compare,
    previewSnapshot,
    visibleVersions,
    focusedIndex,
    renamingId,
    confirmAction,
    startRename,
    currentPage,
    totalPages,
    goToPage,
    cancelConfirm,
  ]);

  // Opening the panel lands focus on the first Version row, so arrow keys move
  // through the list right away. It never yanks focus once the author has moved
  // into a row (or its actions).
  useEffect(() => {
    if (!isOpen || compare || previewSnapshot) return;
    if (visibleVersions.length === 0) return;
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      active.closest('[role="row"]') &&
      listRef.current?.contains(active)
    ) {
      return;
    }
    focusRow(0);
  }, [isOpen, compare, previewSnapshot, visibleVersions, focusRow]);

  // Preview and Compare replace the list. Focus moves onto their Back control
  // so Escape/Tab act there, and returns to the Version row when it is closed.
  const showingSubview = Boolean(compare || previewSnapshot);
  const previousShowingSubview = useRef(false);
  useEffect(() => {
    if (!isOpen) {
      previousShowingSubview.current = false;
      return;
    }
    if (showingSubview) {
      document.getElementById("version-back")?.focus();
      previousShowingSubview.current = true;
    } else if (previousShowingSubview.current) {
      previousShowingSubview.current = false;
      focusRow(focusedIndex);
    }
  }, [isOpen, showingSubview, focusRow, focusedIndex]);

  // Scroll focused row into view
  useEffect(() => {
    if (!isOpen || compare || previewSnapshot) return;
    rowElement(focusedIndex)?.scrollIntoView({ block: "nearest" });
  }, [focusedIndex, isOpen, compare, previewSnapshot, rowElement]);

  const isInitialLoading = isLoading && visibleVersions.length === 0 && totalCount === 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("versions.title")}
      size="wide"
      contentClassName={compare ? "overflow-hidden" : undefined}
    >
      {isInitialLoading ? (
        <div className="text-center py-8 text-muted-foreground">{t("common.loading")}</div>
      ) : previewSnapshot ? (
        <div className="flex flex-col gap-3 h-full min-h-0">
          <Button
            id="version-back"
            variant="ghost"
            size="sm"
            onClick={() => setPreviewSnapshot(null)}
            className="self-start shrink-0"
          >
            <ArrowLeft className="w-4 h-4 mr-1" />
            {t("common.back")}
          </Button>
          <VersionPreview snapshot={previewSnapshot} />
        </div>
      ) : compare ? (
        <div
          data-testid="version-compare-layout"
          className="flex h-[min(36rem,calc(90vh-9rem))] max-h-144 min-h-0 flex-col gap-3 overflow-hidden"
          style={{ height: "calc(90dvh - 9rem)" }}
        >
          <Button
            id="version-back"
            variant="ghost"
            size="sm"
            onClick={() => setCompare(null)}
            className="self-start shrink-0"
          >
            <ArrowLeft className="w-4 h-4 mr-1" />
            {t("common.back")}
          </Button>
          <p className="shrink-0 text-sm text-muted-foreground">{t("versions.compareToCurrent")}</p>
          <div data-testid="version-compare-body" className="min-h-0 flex-1 overflow-hidden">
            <Suspense
              fallback={
                <div className="text-center py-8 text-muted-foreground">{t("common.loading")}</div>
              }
            >
              <VersionCompare current={compare.current} target={compare.target} />
            </Suspense>
          </div>
        </div>
      ) : totalCount === 0 ? (
        <div className="text-center py-8 text-muted-foreground">{t("versions.empty")}</div>
      ) : (
        <div className="flex flex-col gap-3">
          {/* The row with focus is the one r, Delete and F2 act on. React focus
              events bubble through portals (a row's tooltips), so only this
              list's rows count. GridList does not forward aria-busy, so the
              wrapper carries it. */}
          <div
            aria-busy={isLoading}
            onFocusCapture={(event) => {
              const row = (event.target as HTMLElement).closest<HTMLElement>(
                '[role="row"][data-key]'
              );
              if (!row || !listRef.current?.contains(row)) return;
              const index = visibleVersions.findIndex((v) => v.id === row.dataset.key);
              if (index >= 0) setFocusedIndex(index);
            }}
          >
            <GridList
              ref={listRef}
              aria-label={t("versions.title")}
              className={`flex flex-col gap-1 transition-opacity ${isLoading ? "opacity-60" : ""}`}
              disallowTypeAhead
              onAction={(key) => {
                const version = visibleVersions.find((candidate) => candidate.id === key);
                if (version) void handleCompare(version);
              }}
            >
              {visibleVersions.map((version, index) => {
                const isFocused = focusedIndex === index;
                const isConfirming = confirmAction?.versionId === version.id;
                const isRenaming = renamingId === version.id;

                return (
                  <GridListItem
                    key={version.id}
                    id={version.id}
                    textValue={version.name ?? t("versions.autoCheckpoint")}
                    className={`flex items-center gap-2 px-2 py-2 rounded-lg outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary ${
                      isFocused ? "bg-muted ring-1 ring-primary/30" : "hover:bg-muted/50"
                    }`}
                    onHoverStart={() => setFocusedIndex(index)}
                  >
                    {isRenaming ? (
                      <div
                        className="flex-1 flex gap-2 items-center"
                        ref={keepFocusRestoreInRowForm}
                        onKeyDown={routeRowFormKeys}
                        onClick={keepRowFromClick}
                      >
                        <Input
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void handleRename(version.id);
                            }
                            if (e.key === "Escape") {
                              e.preventDefault();
                              setRenamingId(null);
                              focusRow(focusedIndex);
                            }
                          }}
                          autoFocus
                          className="flex-1"
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void handleRename(version.id)}
                        >
                          <Check className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setRenamingId(null);
                            focusRow(focusedIndex);
                          }}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    ) : isConfirming ? (
                      <div
                        className="flex-1 flex items-center gap-2"
                        ref={keepFocusRestoreInRowForm}
                        onKeyDown={routeRowFormKeys}
                        onClick={keepRowFromClick}
                      >
                        <span className="text-sm flex-1">
                          {confirmAction?.type === "restore"
                            ? t("versions.restoreConfirm")
                            : t("versions.deleteConfirm")}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={cancelConfirm}
                          aria-label={t("common.cancel")}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                        <Button
                          id="version-confirm"
                          // The confirm takes focus so Enter confirms and Escape
                          // (cancelConfirm) returns to the row.
                          autoFocus
                          variant={confirmAction?.type === "restore" ? "primary" : "destructive"}
                          size="sm"
                          aria-label={
                            confirmAction?.type === "restore"
                              ? t("versions.restore")
                              : t("versions.delete")
                          }
                          onClick={() => {
                            if (confirmAction?.type === "restore") {
                              void handleRestore(version);
                            } else {
                              void handleDelete(version.id);
                            }
                          }}
                        >
                          <Check className="w-4 h-4" />
                        </Button>
                      </div>
                    ) : (
                      <>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium truncate">
                              {version.name ?? t("versions.autoCheckpoint")}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0">
                              {t(`versions.trigger.${version.triggerType}`)}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {formatRelativeTime(version.createdAt, i18n.language)} ·{" "}
                            {version.wordCount} {t("common.words")}
                          </div>
                        </div>

                        <TooltipGroup>
                          <div
                            className="flex items-center gap-0.5 shrink-0"
                            onKeyDown={keepRowFromActing}
                            onClick={keepRowFromClick}
                          >
                            <Tooltip content={t("versions.preview")}>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => void handlePreview(version)}
                                aria-label={t("versions.preview")}
                                className="px-1.5"
                              >
                                <Eye className="w-4 h-4" />
                              </Button>
                            </Tooltip>
                            <Tooltip content={t("versions.compare")}>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => void handleCompare(version)}
                                aria-label={t("versions.compare")}
                                className="px-1.5"
                              >
                                <GitCompareArrows className="w-4 h-4" />
                              </Button>
                            </Tooltip>
                            <Tooltip content={t("versions.restore")}>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  setConfirmAction({
                                    type: "restore",
                                    versionId: version.id,
                                  })
                                }
                                aria-label={t("versions.restore")}
                                className="px-1.5"
                              >
                                <RotateCcw className="w-4 h-4" />
                              </Button>
                            </Tooltip>
                            <Tooltip content={t("versions.rename")}>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => startRename(version)}
                                aria-label={t("versions.rename")}
                                className="px-1.5"
                              >
                                <Pencil className="w-4 h-4" />
                              </Button>
                            </Tooltip>
                            <Tooltip content={t("versions.delete")}>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  setConfirmAction({
                                    type: "delete",
                                    versionId: version.id,
                                  })
                                }
                                aria-label={t("versions.delete")}
                                className="px-1.5"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </Tooltip>
                          </div>
                        </TooltipGroup>
                      </>
                    )}
                  </GridListItem>
                );
              })}
            </GridList>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => goToPage(currentPage - 1)}
                disabled={currentPage === 1 || isLoading}
                aria-label={t("versions.previousPage")}
              >
                <ChevronLeft className="w-4 h-4 mr-1" />
                {t("versions.previousPage")}
              </Button>
              <span className="text-xs text-muted-foreground" aria-live="polite">
                {t("versions.page", { page: currentPage, total: totalPages })}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => goToPage(currentPage + 1)}
                disabled={currentPage === totalPages || isLoading}
                aria-label={t("versions.nextPage")}
              >
                {t("versions.nextPage")}
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
