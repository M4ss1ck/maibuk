import { useMemo } from "react";
import type { Chapter } from "../../features/chapters/types";
import { useTranslation } from "react-i18next";

interface FootnoteEntry {
  id: string;
  content: string;
  number: number;
  chapterTitle: string;
  chapterId: string;
}

interface FootnotesViewProps {
  chapters: Chapter[];
  currentChapterId: string | null;
  onSelectChapter: (chapter: Chapter) => void;
}

const FOOTNOTE_REGEX =
  /<sup[^>]*data-footnote-content="([^"]*)"[^>]*data-footnote-id="([^"]*)"[^>]*>/gi;

function extractFootnotes(chapters: Chapter[]): FootnoteEntry[] {
  const entries: FootnoteEntry[] = [];
  let globalCount = 0;

  // Chapters are already sorted by order
  const sorted = [...chapters].sort((a, b) => a.order - b.order);

  for (const chapter of sorted) {
    if (!chapter.content) continue;

    // Reset regex state
    FOOTNOTE_REGEX.lastIndex = 0;
    let match = FOOTNOTE_REGEX.exec(chapter.content);

    while (match !== null) {
      globalCount++;
      entries.push({
        id: match[2],
        content: decodeHtmlEntities(match[1]),
        number: globalCount,
        chapterTitle: chapter.title,
        chapterId: chapter.id,
      });
      match = FOOTNOTE_REGEX.exec(chapter.content);
    }
  }

  return entries;
}

function decodeHtmlEntities(text: string): string {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = text;
  return textarea.value;
}

export function FootnotesView({
  chapters,
  currentChapterId,
  onSelectChapter,
}: FootnotesViewProps) {
  const { t } = useTranslation();

  const footnotes = useMemo(() => extractFootnotes(chapters), [chapters]);

  if (footnotes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground px-4 py-3">
        {t("editor.noFootnotes")}
      </p>
    );
  }

  // Group by chapter
  const grouped = new Map<
    string,
    { title: string; chapter: Chapter; items: FootnoteEntry[] }
  >();
  for (const fn of footnotes) {
    if (!grouped.has(fn.chapterId)) {
      const chapter = chapters.find((c) => c.id === fn.chapterId)!;
      grouped.set(fn.chapterId, { title: fn.chapterTitle, chapter, items: [] });
    }
    grouped.get(fn.chapterId)!.items.push(fn);
  }

  const handleGoToRef = (e: React.MouseEvent, fn: FootnoteEntry) => {
    e.preventDefault();
    // If we're in the right chapter, scroll to the inline ref
    if (fn.chapterId === currentChapterId) {
      const element = document.getElementById(`fnref-${fn.id}`);
      element?.scrollIntoView({ behavior: "smooth" });
    } else {
      // Switch chapter first, then the ref will be in the DOM after re-render
      const chapter = chapters.find((c) => c.id === fn.chapterId);
      if (chapter) {
        onSelectChapter(chapter);
        // Scroll after a short delay to allow the editor to mount
        setTimeout(() => {
          const element = document.getElementById(`fnref-${fn.id}`);
          element?.scrollIntoView({ behavior: "smooth" });
        }, 300);
      }
    }
  };

  return (
    <>
      {Array.from(grouped.entries()).map(([chapterId, group]) => (
        <div key={chapterId} className="notes-chapter-group">
          <h4 className="notes-chapter-title">{group.title}</h4>
          <ol className="notes-list">
            {group.items.map((fn) => (
              <li key={fn.id} className="notes-item" value={fn.number}>
                <span className="footnote-content">{fn.content}</span>
                <a
                  className="footnote-backref"
                  href={`#fnref-${fn.id}`}
                  onClick={(e) => handleGoToRef(e, fn)}
                  title={t("editor.goToReference")}
                >
                  ↩
                </a>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </>
  );
}
