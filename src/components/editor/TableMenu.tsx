import { useState } from "react";
import type { Editor } from "@tiptap/react";

interface TableMenuProps {
  editor: Editor;
}

export function TableMenu({ editor }: TableMenuProps) {
  const [showMenu, setShowMenu] = useState(false);

  const insertTable = (rows: number, cols: number) => {
    editor
      .chain()
      .focus()
      .insertTable({ rows, cols, withHeaderRow: true })
      .run();
    setShowMenu(false);
  };

  const isInTable = editor.isActive("table");

  if (!isInTable && !showMenu) {
    return (
      <button
        onClick={() => setShowMenu(true)}
        title="Insert Table"
        className="p-2 rounded transition-colors hover:bg-muted"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18M10 3v18M14 3v18" />
        </svg>
      </button>
    );
  }

  if (showMenu && !isInTable) {
    return (
      <div className="relative">
        <button
          onClick={() => setShowMenu(false)}
          title="Insert Table"
          className="p-2 rounded transition-colors bg-primary text-white"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18M10 3v18M14 3v18" />
          </svg>
        </button>

        <div className="absolute top-full left-0 mt-1 bg-card border border-border rounded-lg shadow-lg p-3 z-50">
          <p className="text-sm text-muted-foreground mb-2">Select table size:</p>
          <div className="grid grid-cols-5 gap-1">
            {[1, 2, 3, 4, 5].map((row) =>
              [1, 2, 3, 4, 5].map((col) => (
                <button
                  key={`${row}-${col}`}
                  onClick={() => insertTable(row, col)}
                  className="w-6 h-6 border border-border hover:bg-primary hover:border-primary rounded text-xs"
                  title={`${row}x${col} table`}
                />
              ))
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-2 text-center">
            Click to insert table
          </p>
        </div>
      </div>
    );
  }

  // Table editing controls when inside a table
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => editor.chain().focus().addColumnBefore().run()}
        disabled={!editor.can().addColumnBefore()}
        title="Add Column Before"
        className="p-1.5 rounded transition-colors hover:bg-muted disabled:opacity-50"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19V5M5 12h6" />
        </svg>
      </button>

      <button
        onClick={() => editor.chain().focus().addColumnAfter().run()}
        disabled={!editor.can().addColumnAfter()}
        title="Add Column After"
        className="p-1.5 rounded transition-colors hover:bg-muted disabled:opacity-50"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5v14M13 12h6" />
        </svg>
      </button>

      <button
        onClick={() => editor.chain().focus().addRowBefore().run()}
        disabled={!editor.can().addRowBefore()}
        title="Add Row Before"
        className="p-1.5 rounded transition-colors hover:bg-muted disabled:opacity-50"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 11h14M12 5v6" />
        </svg>
      </button>

      <button
        onClick={() => editor.chain().focus().addRowAfter().run()}
        disabled={!editor.can().addRowAfter()}
        title="Add Row After"
        className="p-1.5 rounded transition-colors hover:bg-muted disabled:opacity-50"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13h14M12 13v6" />
        </svg>
      </button>

      <div className="w-px h-4 bg-border mx-1" />

      <button
        onClick={() => editor.chain().focus().deleteColumn().run()}
        disabled={!editor.can().deleteColumn()}
        title="Delete Column"
        className="p-1.5 rounded transition-colors hover:bg-destructive/10 text-destructive disabled:opacity-50"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v18M15 3v18M6 12h12" />
        </svg>
      </button>

      <button
        onClick={() => editor.chain().focus().deleteRow().run()}
        disabled={!editor.can().deleteRow()}
        title="Delete Row"
        className="p-1.5 rounded transition-colors hover:bg-destructive/10 text-destructive disabled:opacity-50"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9h18M3 15h18M12 6v12" />
        </svg>
      </button>

      <button
        onClick={() => editor.chain().focus().deleteTable().run()}
        disabled={!editor.can().deleteTable()}
        title="Delete Table"
        className="p-1.5 rounded transition-colors hover:bg-destructive/10 text-destructive disabled:opacity-50"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      </button>
    </div>
  );
}
