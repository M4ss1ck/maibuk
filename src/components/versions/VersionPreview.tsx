import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { BookSnapshot } from "../../features/sync/types";
import { sanitizeChapterHtml } from "../../features/versions/sanitize";

interface VersionPreviewProps {
  snapshot: BookSnapshot;
}

export function VersionPreview({ snapshot }: VersionPreviewProps) {
  const { t } = useTranslation();
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(
    snapshot.chapters[0]?.id ?? null
  );

  const selectedChapter = snapshot.chapters.find((c) => c.id === selectedChapterId);

  return (
    <div className="flex flex-col gap-3 h-full min-h-0">
      <h3 className="text-sm font-semibold text-foreground shrink-0">{snapshot.book.title}</h3>

      {/* Chapter list */}
      <div className="flex flex-col gap-0.5 max-h-36 overflow-auto shrink-0">
        {snapshot.chapters.map((chapter) => (
          <button
            key={chapter.id}
            type="button"
            onClick={() => setSelectedChapterId(chapter.id)}
            className={`text-left px-2 py-1.5 rounded text-sm transition-colors w-full ${
              selectedChapterId === chapter.id ? "bg-primary/10 text-primary" : "hover:bg-muted"
            }`}
          >
            <span className="truncate block font-medium">{chapter.title}</span>
            <span className="text-xs text-muted-foreground">
              {chapter.wordCount} {t("common.words")}
            </span>
          </button>
        ))}
      </div>

      {/* Chapter content */}
      {selectedChapter ? (
        <div className="flex-1 min-h-0 overflow-auto border border-border rounded-lg p-3 bg-background">
          <div
            className="editor-content"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: chapter HTML is sanitized via sanitizeChapterHtml
            dangerouslySetInnerHTML={{
              __html: sanitizeChapterHtml(selectedChapter.content ?? ""),
            }}
          />
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          {t("editor.noChapter")}
        </div>
      )}
    </div>
  );
}
