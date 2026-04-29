import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { Editor } from "@tiptap/react";
import { spellCheckService } from "../../lib/spellcheck";

interface SpellCheckPopoverProps {
  editor: Editor;
}

type PopoverState = {
  word: string;
  from: number;
  to: number;
  position: { top: number; left: number };
  suggestions: string[];
  isLoading: boolean;
};

export function SpellCheckPopover({ editor }: SpellCheckPopoverProps) {
  const { t } = useTranslation();
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const isOpen = !!popover;

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setPopover(null);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPopover(null);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !popoverRef.current || !popover) return;

    const rect = popoverRef.current.getBoundingClientRect();
    const adjusted = adjustPopoverPosition(popover.position, rect);

    if (adjusted.left !== popover.position.left || adjusted.top !== popover.position.top) {
      setPopover((prev) => (prev ? { ...prev, position: adjusted } : prev));
    }
  }, [isOpen, popover]);

  useEffect(() => {
    const handleContextMenu = (event: MouseEvent) => {
      const position = editor.view.posAtCoords({ left: event.clientX, top: event.clientY });
      const misspelling = position
        ? editor.storage.spellCheck?.getMisspellingAt?.(position.pos)
        : null;

      if (!misspelling) {
        setPopover(null);
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const nextPosition = clampPopoverPosition(event.clientX, event.clientY);
      setPopover({
        word: misspelling.word,
        from: misspelling.from,
        to: misspelling.to,
        position: nextPosition,
        suggestions: [],
        isLoading: true,
      });

      void spellCheckService.suggest(misspelling.word).then((suggestions) => {
        setPopover((prev) => {
          if (!prev || prev.word !== misspelling.word || prev.from !== misspelling.from) {
            return prev;
          }
          return {
            ...prev,
            suggestions,
            isLoading: false,
          };
        });
      });
    };

    const editorElement = editor.view.dom;
    editorElement.addEventListener("contextmenu", handleContextMenu);

    return () => {
      editorElement.removeEventListener("contextmenu", handleContextMenu);
    };
  }, [editor]);

  if (!isOpen) return null;

  const topSuggestions = popover.suggestions.slice(0, 5);

  return createPortal(
    <div
      ref={popoverRef}
      className="fixed z-50 w-56 max-h-[60vh] rounded-lg border border-border bg-card shadow-lg flex flex-col"
      style={{ top: popover.position.top, left: popover.position.left }}
    >
      <div className="px-3 py-2 border-b border-border shrink-0">
        <p className="text-xs text-muted-foreground truncate">{popover.word}</p>
      </div>

      <div className="py-1 overflow-auto">
        {popover.isLoading ? (
          <div className="px-3 py-2 text-sm text-muted-foreground">{t("common.loading")}</div>
        ) : topSuggestions.length > 0 ? (
          topSuggestions.map((suggestion) => (
            <button
              key={suggestion}
              onClick={() => {
                editor
                  .chain()
                  .focus()
                  .insertContentAt({ from: popover.from, to: popover.to }, suggestion)
                  .run();
                setPopover(null);
              }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors"
            >
              {suggestion}
            </button>
          ))
        ) : (
          <div className="px-3 py-2 text-sm text-muted-foreground">{t("editor.noSuggestions")}</div>
        )}
      </div>

      <div className="border-t border-border p-2 shrink-0">
        <button
          onClick={() => {
            editor.commands.addToDictionary(popover.word);
            setPopover(null);
          }}
          className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted transition-colors"
        >
          {t("editor.addToDictionary")}
        </button>
      </div>
    </div>,
    document.body
  );
}

function clampPopoverPosition(clientX: number, clientY: number) {
  const width = 224;
  const height = 180;
  const padding = 8;
  const maxLeft = window.innerWidth - width - padding;
  const maxTop = window.innerHeight - height - padding;
  return {
    left: Math.min(Math.max(clientX, padding), Math.max(maxLeft, padding)),
    top: Math.min(Math.max(clientY, padding), Math.max(maxTop, padding)),
  };
}

function adjustPopoverPosition(position: { top: number; left: number }, rect: DOMRect) {
  const padding = 8;
  const maxLeft = window.innerWidth - rect.width - padding;
  const maxTop = window.innerHeight - rect.height - padding;
  return {
    left: Math.min(Math.max(position.left, padding), Math.max(maxLeft, padding)),
    top: Math.min(Math.max(position.top, padding), Math.max(maxTop, padding)),
  };
}
