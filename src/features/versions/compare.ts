import htmldiff from "node-htmldiff";
import type { BookSnapshot } from "../sync/types";
import { sanitizeChapterHtml } from "./sanitize";

export type ChapterDiffStatus = "added" | "removed" | "modified" | "unchanged";

export interface ChapterDiff {
  chapterId: string;
  title: string;
  status: ChapterDiffStatus;
  html: string | null;
}

export interface BookDiff {
  chapters: ChapterDiff[];
}

type SnapshotChapter = BookSnapshot["chapters"][number];

function chapterHtml(chapter: SnapshotChapter): string {
  return chapter.content ?? "";
}

function buildModifiedDiff(current: SnapshotChapter, target: SnapshotChapter): ChapterDiff {
  const targetHtml = chapterHtml(target);

  try {
    return {
      chapterId: target.id,
      title: target.title,
      status: "modified",
      html: sanitizeChapterHtml(htmldiff(chapterHtml(current), targetHtml)),
    };
  } catch {
    return {
      chapterId: target.id,
      title: target.title,
      status: "modified",
      html: sanitizeChapterHtml(targetHtml),
    };
  }
}

export function diffSnapshots(current: BookSnapshot, target: BookSnapshot): BookDiff {
  const currentChapters = new Map<string, SnapshotChapter>(
    current.chapters.map((chapter) => [chapter.id, chapter])
  );
  const targetChapters = new Map<string, SnapshotChapter>(
    target.chapters.map((chapter) => [chapter.id, chapter])
  );
  const chapters: ChapterDiff[] = [];

  for (const targetChapter of target.chapters) {
    const currentChapter = currentChapters.get(targetChapter.id);
    const targetHtml = chapterHtml(targetChapter);

    if (!currentChapter) {
      chapters.push({
        chapterId: targetChapter.id,
        title: targetChapter.title,
        status: "added",
        html: sanitizeChapterHtml(targetHtml),
      });
      continue;
    }

    if (chapterHtml(currentChapter) === targetHtml) {
      chapters.push({
        chapterId: targetChapter.id,
        title: targetChapter.title,
        status: "unchanged",
        html: null,
      });
      continue;
    }

    chapters.push(buildModifiedDiff(currentChapter, targetChapter));
  }

  for (const currentChapter of current.chapters) {
    if (targetChapters.has(currentChapter.id)) continue;

    chapters.push({
      chapterId: currentChapter.id,
      title: currentChapter.title,
      status: "removed",
      html: sanitizeChapterHtml(chapterHtml(currentChapter)),
    });
  }

  return { chapters };
}
