import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import type { Chapter } from "@/features/chapters/types";
import {
  collectFootnotes,
  findFootnote,
  type FootnoteTarget,
  footnoteKeys,
} from "@/components/editor/extensions/Footnote";
import {
  type FootnoteGridItem,
  type FootnoteGridSection,
  FootnoteGrid,
} from "@/components/editor/FootnoteGrid";

interface FootnotesViewProps {
  chapters: Chapter[];
  currentChapterId: string | null;
  onSelectChapter: (chapter: Chapter) => void;
  /** The open Chapter's editor: its Footnotes are read live and changed through it. */
  editor?: Editor | null;
  /** Where focus goes when a Delete removed the book's last Footnote. */
  onEmptied?: () => void;
}

interface ChapterFootnote {
  id: string;
  content: string;
}

interface FootnoteEntry extends FootnoteGridItem {
  chapterId: string;
}

/** An Edit or Delete on another Chapter's Footnote, run once that Chapter's editor is open. */
type PendingChange = FootnoteTarget & {
  chapterId: string;
  /** The editor open when the author asked (another Chapter's); the change never lands there. */
  requestedIn: Editor | null;
} & ({ kind: "edit"; content: string } | { kind: "delete" });

// Attribute order is not guaranteed in stored HTML (imports, older saves).
const FOOTNOTE_TAG = /<sup\b[^>]*\bdata-footnote-id="[^"]*"[^>]*>/gi;
const FOOTNOTE_ID = /\bdata-footnote-id="([^"]*)"/i;
const FOOTNOTE_CONTENT = /\bdata-footnote-content="([^"]*)"/i;

function storedFootnotes(content: string): ChapterFootnote[] {
  return Array.from(content.matchAll(FOOTNOTE_TAG), ([tag]) => ({
    id: decodeHtmlEntities(FOOTNOTE_ID.exec(tag)?.[1] ?? ""),
    content: decodeHtmlEntities(FOOTNOTE_CONTENT.exec(tag)?.[1] ?? ""),
  }));
}

function decodeHtmlEntities(text: string): string {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = text;
  return textarea.value;
}

function applyChange(editor: Editor, change: PendingChange): boolean {
  const target = { id: change.id, index: change.index };
  return change.kind === "edit"
    ? editor.commands.updateFootnote(target, change.content)
    : editor.commands.deleteFootnote(target);
}

export function FootnotesView({
  chapters,
  currentChapterId,
  onSelectChapter,
  editor = null,
  onEmptied,
}: FootnotesViewProps) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<PendingChange | null>(null);
  const reachedPendingChapterRef = useRef(false);

  // The open Chapter's saved text lags its editor by a typing burst and a
  // save; read its Footnotes from the editor so an Edit shows at once.
  const liveFootnotes = useEditorState({
    editor,
    selector: ({ editor: e }): ChapterFootnote[] | null =>
      e && !e.isDestroyed
        ? collectFootnotes(e.state.doc).map(({ id, content }) => ({ id, content }))
        : null,
  });

  useEffect(() => {
    if (!pending) return;
    if (currentChapterId !== pending.chapterId) {
      // The author moved on to another Chapter before this one opened.
      if (reachedPendingChapterRef.current) setPending(null);
      return;
    }
    reachedPendingChapterRef.current = true;
    if (!editor || editor.isDestroyed || editor === pending.requestedIn) return;

    // The Chapter's text may still be loading into its new editor.
    const tryApply = () => {
      if (!findFootnote(editor.state.doc, pending)) return;
      applyChange(editor, pending);
      setPending(null);
    };
    tryApply();
    editor.on("update", tryApply);
    return () => {
      editor.off("update", tryApply);
    };
  }, [pending, editor, currentChapterId]);

  const sorted = [...chapters].sort((a, b) => a.order - b.order);
  const sections: FootnoteGridSection<FootnoteEntry>[] = [];
  let count = 0;
  for (const chapter of sorted) {
    const found =
      chapter.id === currentChapterId && liveFootnotes
        ? liveFootnotes
        : chapter.content
          ? storedFootnotes(chapter.content)
          : [];
    if (found.length === 0) continue;
    const keys = footnoteKeys(
      found.map((footnote) => footnote.id),
      `${chapter.id}:`
    );
    sections.push({
      key: chapter.id,
      title: chapter.title,
      items: found.map((footnote, index) => ({
        key: keys[index],
        id: footnote.id,
        index,
        number: ++count,
        content: footnote.content,
        chapterId: chapter.id,
      })),
    });
  }

  if (sections.length === 0) {
    return <p className="text-sm text-muted-foreground px-4 py-3">{t("editor.noFootnotes")}</p>;
  }

  const scrollToRef = (id: string) => {
    document.getElementById(`fnref-${id}`)?.scrollIntoView({ behavior: "smooth" });
  };

  const handleGoTo = (item: FootnoteEntry) => {
    if (item.chapterId === currentChapterId) {
      scrollToRef(item.id);
      return;
    }
    const chapter = chapters.find((c) => c.id === item.chapterId);
    if (!chapter) return;
    onSelectChapter(chapter);
    // Scroll after a short delay to allow the editor to mount
    setTimeout(() => scrollToRef(item.id), 300);
  };

  // The open Chapter changes at once; another Chapter opens first, then changes.
  const change = (item: FootnoteEntry, footnoteChange: PendingChange) => {
    if (item.chapterId === currentChapterId && editor && !editor.isDestroyed) {
      applyChange(editor, footnoteChange);
      return;
    }
    const chapter = chapters.find((c) => c.id === item.chapterId);
    if (!chapter) return;
    reachedPendingChapterRef.current = false;
    setPending(footnoteChange);
    onSelectChapter(chapter);
  };

  const target = (item: FootnoteEntry) => ({
    id: item.id,
    index: item.index,
    chapterId: item.chapterId,
    requestedIn: editor,
  });

  return (
    <FootnoteGrid
      label={t("bookSidePanel.footnotes")}
      sections={sections}
      onGoTo={handleGoTo}
      onSave={(item, content) => change(item, { ...target(item), kind: "edit", content })}
      onDelete={(item) => change(item, { ...target(item), kind: "delete" })}
      onEmptied={onEmptied}
      className="footnote-list-panel"
      headerClassName="notes-chapter-title"
    />
  );
}
