import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import { TableSizePicker } from "@/components/editor/TableSizePicker";
import { Tooltip, TooltipGroup } from "@/components/ui";
import {
  Table,
  Columns2,
  Rows2,
  Trash2,
  BetweenVerticalStart,
  BetweenVerticalEnd,
  BetweenHorizonalStart,
  BetweenHorizonalEnd,
} from "lucide-react";

interface TableMenuProps {
  editor: Editor;
  wrapItems?: boolean;
}

export function TableMenu({ editor, wrapItems = false }: TableMenuProps) {
  const { t } = useTranslation();
  const [showMenu, setShowMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{
    top: number;
    left: number;
  }>({
    top: 0,
    left: 0,
  });
  const buttonRef = useRef<HTMLButtonElement>(null);

  const insertTable = (rows: number, cols: number, withHeaderRow: boolean) => {
    editor.chain().focus().insertTable({ rows, cols, withHeaderRow }).run();
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
        !(e.target instanceof HTMLElement && e.target.closest(".tiptap-table-menu-portal"))
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
    setShowMenu((isOpen) => !isOpen);
  };

  return (
    <TooltipGroup>
      <div className={wrapItems ? "contents" : "flex items-center gap-1"}>
        <Tooltip content={t("editor.insertTable")}>
          <button
            ref={buttonRef}
            type="button"
            onClick={handleShowMenu}
            disabled={isInTable}
            aria-label={t("editor.insertTable")}
            className={`p-2 rounded transition-colors ${
              showMenu ? "bg-primary text-white" : "hover:bg-muted"
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <Table className="w-4 h-4" />
          </button>
        </Tooltip>

        <Tooltip content={t("editor.addColumnBefore")}>
          <button
            type="button"
            onClick={() => editor.chain().focus().addColumnBefore().run()}
            disabled={!editor.can().addColumnBefore()}
            aria-label={t("editor.addColumnBefore")}
            className="p-1.5 rounded transition-colors hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <BetweenVerticalStart className="w-3.5 h-3.5" />
          </button>
        </Tooltip>

        <Tooltip content={t("editor.addColumnAfter")}>
          <button
            type="button"
            onClick={() => editor.chain().focus().addColumnAfter().run()}
            disabled={!editor.can().addColumnAfter()}
            aria-label={t("editor.addColumnAfter")}
            className="p-1.5 rounded transition-colors hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <BetweenVerticalEnd className="w-3.5 h-3.5" />
          </button>
        </Tooltip>

        <Tooltip content={t("editor.addRowBefore")}>
          <button
            type="button"
            onClick={() => editor.chain().focus().addRowBefore().run()}
            disabled={!editor.can().addRowBefore()}
            aria-label={t("editor.addRowBefore")}
            className="p-1.5 rounded transition-colors hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <BetweenHorizonalStart className="w-3.5 h-3.5" />
          </button>
        </Tooltip>

        <Tooltip content={t("editor.addRowAfter")}>
          <button
            type="button"
            onClick={() => editor.chain().focus().addRowAfter().run()}
            disabled={!editor.can().addRowAfter()}
            aria-label={t("editor.addRowAfter")}
            className="p-1.5 rounded transition-colors hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <BetweenHorizonalEnd className="w-3.5 h-3.5" />
          </button>
        </Tooltip>

        <div className="w-px h-4 bg-border mx-1" />

        <Tooltip content={t("editor.deleteColumn")}>
          <button
            type="button"
            onClick={() => editor.chain().focus().deleteColumn().run()}
            disabled={!editor.can().deleteColumn()}
            aria-label={t("editor.deleteColumn")}
            className="p-1.5 rounded transition-colors hover:bg-destructive/10 text-destructive disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Columns2 className="w-3.5 h-3.5" />
          </button>
        </Tooltip>

        <Tooltip content={t("editor.deleteRow")}>
          <button
            type="button"
            onClick={() => editor.chain().focus().deleteRow().run()}
            disabled={!editor.can().deleteRow()}
            aria-label={t("editor.deleteRow")}
            className="p-1.5 rounded transition-colors hover:bg-destructive/10 text-destructive disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Rows2 className="w-3.5 h-3.5" />
          </button>
        </Tooltip>

        <Tooltip content={t("editor.deleteTable")}>
          <button
            type="button"
            onClick={() => editor.chain().focus().deleteTable().run()}
            disabled={!editor.can().deleteTable()}
            aria-label={t("editor.deleteTable")}
            className="p-1.5 rounded transition-colors hover:bg-destructive/10 text-destructive disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </Tooltip>
      </div>

      {showMenu &&
        !isInTable &&
        createPortal(
          <div
            className="tiptap-table-menu-portal fixed bg-card border border-border rounded-lg shadow-lg p-3 z-50"
            style={{ top: menuPosition.top, left: menuPosition.left }}
          >
            <TableSizePicker onSelect={insertTable} />
          </div>,
          document.body
        )}
    </TooltipGroup>
  );
}
