import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import { Switch } from "../ui";

interface TableMenuProps {
  editor: Editor;
}

export function TableMenu({ editor }: TableMenuProps) {
  const { t } = useTranslation();
  const [showMenu, setShowMenu] = useState(false);
  const [addheaderRow, setAddHeaderRow] = useState(true);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [hoveredCell, setHoveredCell] = useState<{ row: number; col: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const insertTable = (rows: number, cols: number) => {
    console.log("Inserting table:", rows, "rows x", cols, "cols");
    editor
      .chain()
      .focus()
      .insertTable({ rows, cols, withHeaderRow: addheaderRow })
      .run();
    setShowMenu(false);
  };

  const isInTable = editor.isActive("table");

  useEffect(() => {
    if (!showMenu) return;
    const handleClick = (e: MouseEvent) => {
      // Only close if click is outside both the button and the menu
      if (
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node) &&
        !(e.target instanceof HTMLElement && e.target.closest('.tiptap-table-menu-portal'))
      ) {
        setShowMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showMenu]);

  const handleShowMenu = () => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setMenuPosition({
        top: rect.bottom + 4,
        left: rect.left,
      });
    }
    setShowMenu(true);
  };

  if (!isInTable && !showMenu) {
    return (
      <button
        ref={buttonRef}
        onClick={handleShowMenu}
        title={t("editor.insertTable")}
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
      <>
        <button
          ref={buttonRef}
          onClick={() => setShowMenu(false)}
          title={t("editor.insertTable")}
          className="p-2 rounded transition-colors bg-primary text-white"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18M10 3v18M14 3v18" />
          </svg>
        </button>
        {createPortal(
          <div
            className="tiptap-table-menu-portal fixed bg-card border border-border rounded-lg shadow-lg p-3 z-50"
            style={{ top: menuPosition.top, left: menuPosition.left }}
          >
            <p className="text-sm text-muted-foreground mb-2">{t("editor.selectTableSize")}:</p>
            <div className="grid grid-cols-5 gap-0.5">
              {[1, 2, 3, 4, 5].map((row) =>
                [1, 2, 3, 4, 5].map((col) => {
                  const isActive = hoveredCell && row <= hoveredCell.row && col <= hoveredCell.col;
                  return (
                    <button
                      key={`${row}-${col}`}
                      onClick={() => insertTable(row, col)}
                      onMouseEnter={() => setHoveredCell({ row, col })}
                      onMouseLeave={() => setHoveredCell(null)}
                      className={`w-full h-6 border border-muted rounded text-xs ${isActive ? "bg-primary text-white border-primary" : "hover:bg-primary hover:border-primary"}`}
                      title={`${t("editor.table", { dimensions: `${row}x${col}` })}`}
                    />
                  );
                })
              )}
            </div>
            <div className="flex items-center justify-center mt-2">
              <p className="mr-auto text-sm text-muted-foreground">{t("editor.addHeaderRow")}</p>
              <Switch
                checked={addheaderRow}
                onChange={setAddHeaderRow}
                className="h-2"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-2 text-center">
              {hoveredCell ? `${t("editor.insertTable")} (${hoveredCell.row}x${hoveredCell.col})` : t("editor.insertTable")}
            </p>
          </div>,
          document.body
        )}
      </>
    );
  }

  // Table editing controls when inside a table
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => editor.chain().focus().addColumnBefore().run()}
        disabled={!editor.can().addColumnBefore()}
        title={t("editor.addColumnBefore")}
        className="p-1.5 rounded transition-colors hover:bg-muted disabled:opacity-50"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19V5M5 12h6" />
        </svg>
      </button>

      <button
        onClick={() => editor.chain().focus().addColumnAfter().run()}
        disabled={!editor.can().addColumnAfter()}
        title={t("editor.addColumnAfter")}
        className="p-1.5 rounded transition-colors hover:bg-muted disabled:opacity-50"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5v14M13 12h6" />
        </svg>
      </button>

      <button
        onClick={() => editor.chain().focus().addRowBefore().run()}
        disabled={!editor.can().addRowBefore()}
        title={t("editor.addRowBefore")}
        className="p-1.5 rounded transition-colors hover:bg-muted disabled:opacity-50"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 11h14M12 5v6" />
        </svg>
      </button>

      <button
        onClick={() => editor.chain().focus().addRowAfter().run()}
        disabled={!editor.can().addRowAfter()}
        title={t("editor.addRowAfter")}
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
        title={t("editor.deleteColumn")}
        className="p-1.5 rounded transition-colors hover:bg-destructive/10 text-destructive disabled:opacity-50"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v18M15 3v18M6 12h12" />
        </svg>
      </button>

      <button
        onClick={() => editor.chain().focus().deleteRow().run()}
        disabled={!editor.can().deleteRow()}
        title={t("editor.deleteRow")}
        className="p-1.5 rounded transition-colors hover:bg-destructive/10 text-destructive disabled:opacity-50"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9h18M3 15h18M12 6v12" />
        </svg>
      </button>

      <button
        onClick={() => editor.chain().focus().deleteTable().run()}
        disabled={!editor.can().deleteTable()}
        title={t("editor.deleteTable")}
        className="p-1.5 rounded transition-colors hover:bg-destructive/10 text-destructive disabled:opacity-50"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      </button>
    </div>
  );
}
