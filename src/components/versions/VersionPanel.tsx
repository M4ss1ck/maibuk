import { lazy, Suspense, useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
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
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { toast } from "../ui/Toast";
import { useVersionStore, DEFAULT_VERSIONS_PAGE_SIZE } from "../../features/versions/store";
import type { BookVersion } from "../../features/versions/types";
import type { BookSnapshot } from "../../features/sync/types";
import { serializeBook } from "../../features/sync/serializer";

const VersionCompare = lazy(() =>
  import("./VersionCompare").then((module) => ({ default: module.VersionCompare }))
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

export function VersionPanel({
  isOpen,
  onClose,
  bookId,
  flushBeforeCompare,
}: VersionPanelProps) {
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
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);

  useEffect(() => {
    if (isOpen) {
      loadVersions(bookId, 1, DEFAULT_VERSIONS_PAGE_SIZE);
      setCompare(null);
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
        setConfirmAction(null);
      } catch {
        toast.error(t("common.error"));
      }
    },
    [deleteVersion, t]
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

  // Keyboard shortcuts
  useEffect(() => {
    if (!isOpen || compare) return;

    const handler = (e: KeyboardEvent) => {
      if (renamingId) {
        if (e.key === "Escape") {
          e.preventDefault();
          setRenamingId(null);
        }
        return;
      }

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setFocusedIndex((i) => Math.min(i + 1, visibleVersions.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setFocusedIndex((i) => Math.max(i - 1, 0));
          break;
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
        case "Enter": {
          e.preventDefault();
          const v = visibleVersions[focusedIndex];
          if (v) void handleCompare(v);
          break;
        }
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
            setConfirmAction(null);
          }
          break;
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [
    isOpen,
    compare,
    visibleVersions,
    focusedIndex,
    renamingId,
    confirmAction,
    handleCompare,
    startRename,
    currentPage,
    totalPages,
    goToPage,
  ]);

  // Scroll focused row into view
  useEffect(() => {
    if (!isOpen || compare) return;
    const el = document.getElementById(`version-row-${focusedIndex}`);
    el?.scrollIntoView({ block: "nearest" });
  }, [focusedIndex, isOpen, compare]);

  const isInitialLoading = isLoading && visibleVersions.length === 0 && totalCount === 0;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t("versions.title")} size="wide">
      {isInitialLoading ? (
        <div className="text-center py-8 text-muted-foreground">
          {t("common.loading")}
        </div>
      ) : compare ? (
        <div className="flex flex-col gap-3 h-full min-h-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCompare(null)}
            className="self-start"
          >
            <ArrowLeft className="w-4 h-4 mr-1" />
            {t("common.back")}
          </Button>
          <p className="text-sm text-muted-foreground">
            {t("versions.compareToCurrent")}
          </p>
          <Suspense
            fallback={
              <div className="text-center py-8 text-muted-foreground">
                {t("common.loading")}
              </div>
            }
          >
            <VersionCompare current={compare.current} target={compare.target} />
          </Suspense>
        </div>
      ) : totalCount === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          {t("versions.empty")}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div
            className={`flex flex-col gap-1 transition-opacity ${
              isLoading ? "opacity-60" : ""
            }`}
            role="list"
            aria-busy={isLoading}
          >
            {visibleVersions.map((version, index) => {
              const isFocused = focusedIndex === index;
              const isConfirming =
                confirmAction?.versionId === version.id;
              const isRenaming = renamingId === version.id;

              return (
                <div
                  key={version.id}
                  id={`version-row-${index}`}
                  role="listitem"
                  className={`flex items-center gap-2 px-2 py-2 rounded-lg transition-colors ${
                    isFocused
                      ? "bg-muted ring-1 ring-primary/30"
                      : "hover:bg-muted/50"
                  }`}
                  onMouseEnter={() => setFocusedIndex(index)}
                >
                  {isRenaming ? (
                    <div className="flex-1 flex gap-2 items-center">
                      <Input
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void handleRename(version.id);
                          }
                          if (e.key === "Escape") {
                            e.preventDefault();
                            setRenamingId(null);
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
                        onClick={() => setRenamingId(null)}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  ) : isConfirming ? (
                    <div className="flex-1 flex items-center gap-2">
                      <span className="text-sm flex-1">
                        {confirmAction?.type === "restore"
                          ? t("versions.restoreConfirm")
                          : t("versions.deleteConfirm")}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmAction(null)}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                      <Button
                        variant={
                          confirmAction?.type === "restore"
                            ? "primary"
                            : "destructive"
                        }
                        size="sm"
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

                      <div className="flex items-center gap-0.5 shrink-0">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void handleCompare(version)}
                          title={t("versions.compare")}
                          className="px-1.5"
                        >
                          <GitCompareArrows className="w-4 h-4" />
                        </Button>
                        <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setConfirmAction({
                            type: "restore",
                            versionId: version.id,
                          })
                        }
                        title={t("versions.restore")}
                        className="px-1.5"
                      >
                        <RotateCcw className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => startRename(version)}
                        title={t("versions.rename")}
                        className="px-1.5"
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setConfirmAction({
                            type: "delete",
                            versionId: version.id,
                          })
                        }
                        title={t("versions.delete")}
                        className="px-1.5"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
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
