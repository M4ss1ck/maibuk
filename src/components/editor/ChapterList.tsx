import { useState } from "react";
import type { Chapter, ChapterType } from "../../features/chapters/types";

interface ChapterListProps {
  chapters: Chapter[];
  currentChapterId: string | null;
  onSelectChapter: (chapter: Chapter) => void;
  onCreateChapter: (title: string, type: ChapterType) => void;
  onDeleteChapter: (id: string) => void;
  onReorderChapters: (chapterIds: string[]) => void;
}

const chapterTypeLabels: Record<ChapterType, string> = {
  chapter: "Chapter",
  prologue: "Prologue",
  epilogue: "Epilogue",
  part: "Part",
  frontmatter: "Front Matter",
  backmatter: "Back Matter",
};

const chapterTypeIcons: Record<ChapterType, string> = {
  chapter: "📄",
  prologue: "📖",
  epilogue: "📕",
  part: "📚",
  frontmatter: "📋",
  backmatter: "📝",
};

export function ChapterList({
  chapters,
  currentChapterId,
  onSelectChapter,
  onCreateChapter,
  onDeleteChapter,
  onReorderChapters,
}: ChapterListProps) {
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newType, setNewType] = useState<ChapterType>("chapter");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const handleCreate = () => {
    if (newTitle.trim()) {
      onCreateChapter(newTitle.trim(), newType);
      setNewTitle("");
      setNewType("chapter");
      setShowNewDialog(false);
    }
  };

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!draggedId || draggedId === targetId) return;

    const draggedIndex = chapters.findIndex((c) => c.id === draggedId);
    const targetIndex = chapters.findIndex((c) => c.id === targetId);

    if (draggedIndex === -1 || targetIndex === -1) return;

    const newOrder = [...chapters];
    const [removed] = newOrder.splice(draggedIndex, 1);
    newOrder.splice(targetIndex, 0, removed);

    onReorderChapters(newOrder.map((c) => c.id));
    setDraggedId(null);
  };

  const handleDragEnd = () => {
    setDraggedId(null);
  };

  const handleDelete = (id: string) => {
    onDeleteChapter(id);
    setDeleteConfirmId(null);
  };

  return (
    <aside className="w-64 border-r border-border flex flex-col bg-background h-full shrink-0">
      {/* Sticky header */}
      <div className="p-4 border-b border-border flex items-center justify-between bg-background z-10 shrink-0">
        <h3 className="font-medium">Chapters</h3>
        <button
          onClick={() => setShowNewDialog(true)}
          className="p-1 hover:bg-muted rounded transition-colors"
          title="Add Chapter"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      {/* New chapter dialog */}
      {showNewDialog && (
        <div className="p-3 border-b border-border bg-muted/20">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Chapter title..."
            className="w-full px-3 py-2 text-sm border border-border rounded mb-2 bg-background text-foreground"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
              if (e.key === "Escape") setShowNewDialog(false);
            }}
          />
          <select
            value={newType}
            onChange={(e) => setNewType(e.target.value as ChapterType)}
            className="w-full px-3 py-2 text-sm border border-border rounded mb-2 bg-background text-foreground"
          >
            {Object.entries(chapterTypeLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={!newTitle.trim()}
              className="flex-1 px-3 py-1.5 text-sm bg-primary text-white rounded hover:bg-primary-hover disabled:opacity-50 transition-colors"
            >
              Add
            </button>
            <button
              onClick={() => setShowNewDialog(false)}
              className="px-3 py-1.5 text-sm border border-border rounded hover:bg-muted transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Chapter list */}
      <div className="flex-1 overflow-auto">
        {chapters.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            <p>No chapters yet</p>
            <button
              onClick={() => setShowNewDialog(true)}
              className="mt-2 text-primary hover:underline"
            >
              Create your first chapter
            </button>
          </div>
        ) : (
          <ul className="p-2 space-y-1">
            {chapters.map((chapter) => (
              <li
                key={chapter.id}
                draggable={true}
                onDragStart={(e) => handleDragStart(e, chapter.id)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, chapter.id)}
                onDragEnd={handleDragEnd}
                className={`group relative rounded transition-colors cursor-pointer ${draggedId === chapter.id ? "opacity-50" : ""
                  } ${currentChapterId === chapter.id
                    ? "bg-primary/10 border-l-2 border-primary"
                    : "hover:bg-muted/50"
                  }`}
              >
                <button
                  draggable={false}
                  onClick={() => onSelectChapter(chapter)}
                  className="w-full text-left p-3 pr-8"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{chapterTypeIcons[chapter.chapterType]}</span>
                    <span className="font-medium text-sm truncate">{chapter.title}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                    <span>{chapter.wordCount.toLocaleString()} words</span>
                    <span>•</span>
                    <span className="capitalize">{chapter.status}</span>
                  </div>
                </button>

                {/* Delete button */}
                <button
                  draggable={false}
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteConfirmId(chapter.id);
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 opacity-0 group-hover:opacity-100 hover:bg-destructive/10 rounded transition-all"
                  title="Delete chapter"
                >
                  <svg className="w-4 h-4 text-destructive" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>

                {/* Delete confirmation */}
                {deleteConfirmId === chapter.id && (
                  <div className="absolute inset-0 bg-background rounded flex items-center justify-center gap-2 p-2">
                    <span className="text-xs">Delete?</span>
                    <button
                      onClick={() => handleDelete(chapter.id)}
                      className="px-2 py-1 text-xs bg-destructive text-white rounded hover:bg-destructive-hover"
                    >
                      Yes
                    </button>
                    <button
                      onClick={() => setDeleteConfirmId(null)}
                      className="px-2 py-1 text-xs border border-border rounded hover:bg-muted"
                    >
                      No
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Sticky footer - Word count summary */}
      {chapters.length > 0 && (
        <div className="p-3 border-t border-border text-xs text-muted-foreground bg-background shrink-0">
          <div className="flex justify-between">
            <span>Total words:</span>
            <span className="font-medium">
              {chapters.reduce((sum, c) => sum + c.wordCount, 0).toLocaleString()}
            </span>
          </div>
          <div className="flex justify-between mt-1">
            <span>Chapters:</span>
            <span className="font-medium">{chapters.length}</span>
          </div>
        </div>
      )}
    </aside>
  );
}
