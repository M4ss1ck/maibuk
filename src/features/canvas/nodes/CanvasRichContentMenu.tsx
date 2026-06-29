import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { Editor } from "@tiptap/react";
import { MoreHorizontal, ImagePlus, Asterisk } from "lucide-react";
import { TableSizePicker } from "../../../components/editor/TableSizePicker";
import { ImageInsertDialog } from "../../../components/editor/ImageInsertDialog";
import { FootnoteDialog } from "../../../components/editor/FootnoteDialog";

interface CanvasRichContentMenuProps {
  editor: Editor;
  onOverlayOpenChange?: (open: boolean) => void;
}

/**
 * Compact "More" menu for canvas text nodes that exposes table, image, and
 * footnote insertion. The menu and its dialogs render through a document-body
 * portal and report their open state so the active node editor does not commit
 * or unmount while an overlay is in play.
 */
export function CanvasRichContentMenu({ editor, onOverlayOpenChange }: CanvasRichContentMenuProps) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [imageOpen, setImageOpen] = useState(false);
  const [footnoteOpen, setFootnoteOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    onOverlayOpenChange?.(menuOpen || imageOpen || footnoteOpen);
  }, [menuOpen, imageOpen, footnoteOpen, onOverlayOpenChange]);

  const keepEditorSelection = (event: ReactPointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const openMenu = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setMenuPosition({ top: rect.bottom + 4, left: rect.left });
    setMenuOpen(true);
  };

  const closeDialog = (close: () => void) => {
    close();
    editor.commands.focus();
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={t("canvas.moreFormatting")}
        title={t("canvas.moreFormatting")}
        onPointerDown={keepEditorSelection}
        onClick={() => (menuOpen ? setMenuOpen(false) : openMenu())}
        className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {menuOpen &&
        createPortal(
          <div
            className="canvas-rich-content-menu fixed z-50 w-56 rounded-lg border border-border bg-card p-3 shadow-lg"
            style={{ top: menuPosition.top, left: menuPosition.left }}
            onPointerDown={keepEditorSelection}
          >
            <TableSizePicker
              onSelect={(rows, cols, withHeaderRow) => {
                editor.chain().focus().insertTable({ rows, cols, withHeaderRow }).run();
                setMenuOpen(false);
              }}
            />
            <div className="mt-2 flex flex-col gap-1 border-t border-border pt-2">
              <button
                type="button"
                aria-label={t("editor.insertImage")}
                onClick={() => {
                  setMenuOpen(false);
                  setImageOpen(true);
                }}
                className="flex items-center gap-2 rounded p-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted"
              >
                <ImagePlus className="h-4 w-4" aria-hidden="true" />
                {t("editor.insertImage")}
              </button>
              <button
                type="button"
                aria-label={t("editor.insertFootnote")}
                onClick={() => {
                  setMenuOpen(false);
                  setFootnoteOpen(true);
                }}
                className="flex items-center gap-2 rounded p-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted"
              >
                <Asterisk className="h-4 w-4" aria-hidden="true" />
                {t("editor.insertFootnote")}
              </button>
            </div>
          </div>,
          document.body
        )}

      <ImageInsertDialog
        editor={editor}
        isOpen={imageOpen}
        onClose={() => closeDialog(() => setImageOpen(false))}
      />
      <FootnoteDialog
        editor={editor}
        isOpen={footnoteOpen}
        onClose={() => closeDialog(() => setFootnoteOpen(false))}
      />
    </>
  );
}
