import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { BookSnapshot } from "../../features/sync/types";
import { diffSnapshots, type ChapterDiff, type ChapterDiffStatus } from "../../features/versions";
import { sanitizeChapterHtml } from "../../features/versions/sanitize";

interface VersionCompareProps {
  current: BookSnapshot;
  target: BookSnapshot;
}

const STATUS_PREFIX: Record<ChapterDiffStatus, string> = {
  added: "+",
  removed: "-",
  modified: "~",
  unchanged: "=",
};

const STATUS_CLASS: Record<ChapterDiffStatus, string> = {
  added: "text-success",
  removed: "text-destructive",
  modified: "text-primary",
  unchanged: "text-muted-foreground",
};

function StatusBadge({ status }: { status: ChapterDiffStatus }) {
  const { t } = useTranslation();

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
      <span className={STATUS_CLASS[status]}>{STATUS_PREFIX[status]}</span>
      {t(`versions.status.${status}`)}
    </span>
  );
}

function ChapterBanner({ selectedChapter }: { selectedChapter: ChapterDiff }) {
  const { t } = useTranslation();

  if (selectedChapter.status === "added") {
    return (
      <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        {t("versions.chapterAdded")}
      </div>
    );
  }

  if (selectedChapter.status === "removed") {
    return (
      <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        {t("versions.chapterRemoved")}
      </div>
    );
  }

  return null;
}

export function VersionCompare({ current, target }: VersionCompareProps) {
  const { t } = useTranslation();
  const diff = useMemo(() => diffSnapshots(current, target), [current, target]);
  const [showChapterList, setShowChapterList] = useState(true);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(
    diff.chapters[0]?.chapterId ?? null
  );

  const selectedChapter =
    diff.chapters.find((chapter) => chapter.chapterId === selectedChapterId) ?? diff.chapters[0];

  return (
    <div className="flex flex-col gap-3 h-full min-h-0">
      <div className="flex items-center justify-between gap-3 shrink-0">
        <h3 className="min-w-0 truncate text-sm font-semibold text-foreground">
          {target.book.title}
        </h3>
        <button
          type="button"
          onClick={() => setShowChapterList((show) => !show)}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label={t(showChapterList ? "versions.hideChapterList" : "versions.showChapterList")}
          title={t(showChapterList ? "versions.hideChapterList" : "versions.showChapterList")}
        >
          {showChapterList ? (
            <PanelLeftClose className="h-4 w-4" />
          ) : (
            <PanelLeftOpen className="h-4 w-4" />
          )}
        </button>
      </div>

      <div
        className={`grid min-h-0 flex-1 gap-3 ${
          showChapterList
            ? "grid-cols-[minmax(11rem,0.35fr)_minmax(0,1fr)]"
            : "grid-cols-1"
        }`}
      >
        {showChapterList && (
          <div className="min-h-0 overflow-auto rounded-lg border border-border bg-background p-1">
            {diff.chapters.map((chapter) => (
              <button
                key={chapter.chapterId}
                type="button"
                onClick={() => setSelectedChapterId(chapter.chapterId)}
                className={`w-full rounded px-2 py-1.5 text-left transition-colors ${
                  selectedChapter?.chapterId === chapter.chapterId
                    ? "bg-primary/10 text-primary"
                    : "text-foreground hover:bg-muted"
                }`}
              >
                <span className="block truncate text-sm font-medium">{chapter.title}</span>
                <span className="mt-1 block">
                  <StatusBadge status={chapter.status} />
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="min-h-0 overflow-auto rounded-lg border border-border bg-background p-3">
          {selectedChapter ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3 border-b border-border pb-2">
                <h4 className="truncate text-sm font-semibold text-foreground">
                  {selectedChapter.title}
                </h4>
                <StatusBadge status={selectedChapter.status} />
              </div>

              {selectedChapter.status === "unchanged" ? (
                <p className="text-sm text-muted-foreground">{t("versions.noChanges")}</p>
              ) : (
                <>
                  {selectedChapter.fallback && (
                    <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                      {t("versions.compareUnavailable")}
                    </div>
                  )}
                  <ChapterBanner selectedChapter={selectedChapter} />
                  <div
                    className="editor-content"
                    // biome-ignore lint/security/noDangerouslySetInnerHtml: diff HTML is sanitized via sanitizeChapterHtml
                    dangerouslySetInnerHTML={{
                      __html: sanitizeChapterHtml(selectedChapter.html ?? ""),
                    }}
                  />
                </>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("versions.noChanges")}</p>
          )}
        </div>
      </div>
    </div>
  );
}
