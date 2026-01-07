import { useParams } from "react-router-dom";

export function BookEditor() {
  const { bookId: _bookId } = useParams<{ bookId: string }>();
  // TODO: Use bookId to load book and chapters

  return (
    <div className="flex h-full">
      {/* Chapter sidebar */}
      <aside className="w-64 border-r border-[var(--color-border)] flex flex-col">
        <div className="p-4 border-b border-[var(--color-border)] flex items-center justify-between">
          <h3 className="font-medium">Chapters</h3>
          <button className="p-1 hover:bg-[var(--color-border)] rounded">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-auto p-2">
          {/* Chapter list will go here */}
          <div className="text-center py-8 text-[var(--color-muted)] text-sm">
            No chapters yet
          </div>
        </div>
      </aside>

      {/* Editor area */}
      <div className="flex-1 flex flex-col">
        {/* Toolbar */}
        <div className="h-12 border-b border-[var(--color-border)] flex items-center px-4 gap-2">
          <button className="p-2 hover:bg-[var(--color-border)] rounded" title="Bold">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 12h8a4 4 0 100-8H6v8zm0 0h9a4 4 0 110 8H6v-8z" />
            </svg>
          </button>
          <button className="p-2 hover:bg-[var(--color-border)] rounded" title="Italic">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 4h4m-2 0v16m-4 0h8" transform="skewX(-10)" />
            </svg>
          </button>
          <div className="w-px h-6 bg-[var(--color-border)] mx-2" />
          <span className="text-sm text-[var(--color-muted)] ml-auto">0 words</span>
        </div>

        {/* Editor content */}
        <div className="flex-1 overflow-auto">
          <div className="max-w-[var(--spacing-editor-max)] mx-auto p-8">
            <div className="editor-content min-h-[500px] outline-none" contentEditable>
              {/* Tiptap editor will be integrated here */}
              <p className="text-[var(--color-muted)]">Start writing...</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
