import { useState, useRef } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import { Dialog as AriaDialog, Popover } from "react-aria-components";
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
  const buttonRef = useRef<HTMLButtonElement>(null);

  const insertTable = (rows: number, cols: number, withHeaderRow: boolean) => {
    editor.chain().focus().insertTable({ rows, cols, withHeaderRow }).run();
    setShowMenu(false);
  };

  const {
    isInTable,
    canAddColumnBefore,
    canAddColumnAfter,
    canAddRowBefore,
    canAddRowAfter,
    canDeleteColumn,
    canDeleteRow,
    canDeleteTable,
  } = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => {
      const can = currentEditor.can();
      return {
        isInTable: currentEditor.isActive("table"),
        canAddColumnBefore: can.addColumnBefore(),
        canAddColumnAfter: can.addColumnAfter(),
        canAddRowBefore: can.addRowBefore(),
        canAddRowAfter: can.addRowAfter(),
        canDeleteColumn: can.deleteColumn(),
        canDeleteRow: can.deleteRow(),
        canDeleteTable: can.deleteTable(),
      };
    },
  });

  return (
    <TooltipGroup>
      <div className={wrapItems ? "contents" : "flex items-center gap-1"}>
        <Tooltip content={t("editor.insertTable")}>
          <button
            ref={buttonRef}
            type="button"
            onClick={() => setShowMenu((isOpen) => !isOpen)}
            disabled={isInTable}
            aria-label={t("editor.insertTable")}
            aria-expanded={showMenu}
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
            disabled={!canAddColumnBefore}
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
            disabled={!canAddColumnAfter}
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
            disabled={!canAddRowBefore}
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
            disabled={!canAddRowAfter}
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
            disabled={!canDeleteColumn}
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
            disabled={!canDeleteRow}
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
            disabled={!canDeleteTable}
            aria-label={t("editor.deleteTable")}
            className="p-1.5 rounded transition-colors hover:bg-destructive/10 text-destructive disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </Tooltip>
      </div>

      {/* A React Aria popover: focus moves into the picker, Esc closes and returns to the trigger. */}
      <Popover
        triggerRef={buttonRef}
        isOpen={showMenu && !isInTable}
        onOpenChange={setShowMenu}
        placement="bottom start"
        className="tiptap-table-menu-portal z-50 rounded-lg border border-border bg-card p-3 shadow-lg"
      >
        <AriaDialog aria-label={t("editor.insertTable")} className="outline-none">
          <TableSizePicker onSelect={insertTable} />
        </AriaDialog>
      </Popover>
    </TooltipGroup>
  );
}
