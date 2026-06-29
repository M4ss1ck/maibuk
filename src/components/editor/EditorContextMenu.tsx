import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import {
  Code2,
  BookOpen,
  ClipboardCopy,
  ClipboardPaste,
  RemoveFormatting,
  Sparkles,
} from "lucide-react";
import { spellCheckService } from "@/lib/spellcheck";
import { looksLikeMarkdown, markdownToEditorHtml } from "@/features/markdown";
import { Divider } from "@/components/editor/ToolbarButton";
import { adjustPosition, clampPosition, getWordAtPosition } from "@/components/editor/editor-context-menu-utils";
import { fallbackPaste, pasteWithoutFormatting, useClipboardProbe } from "@/components/editor/useClipboardProbe";

interface EditorContextMenuProps {
  editor: Editor;
  onInspect: (blockIndex: number) => void;
  onLookup: (word: string) => void;
  onEditLink?: () => void;
  onOpenChange?: (open: boolean) => void;
}

let menuIdCounter = 0;

type MenuState = {
  id: number;
  position: { top: number; left: number };
  blockIndex: number;
  misspelling: { word: string; from: number; to: number } | null;
  suggestions: string[];
  isLoadingSuggestions: boolean;
  wordUnderCursor: string | null;
  canPaste: boolean;
  hasFormatting: boolean;
  markdown: { from: number; to: number; text: string } | null;
};

/**
 * Unified context menu for the WYSIWYG editor.
 * Combines spell-check suggestions, dictionary lookup, and "Inspect in HTML"
 * into a single right-click menu.
 *
 * Uses bubble phase — runs after ImageContextMenu (capture phase).
 * If ImageContextMenu claims the event, this menu is skipped.
 */
export function EditorContextMenu({
  editor,
  onInspect,
  onLookup,
  onEditLink,
  onOpenChange,
}: EditorContextMenuProps) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const consumeProbe = useClipboardProbe(editor);

  // Notify parent when open state changes
  useEffect(() => {
    onOpenChange?.(menu !== null);
  }, [menu, onOpenChange]);

  const close = useCallback(() => setMenu(null), []);

  const handleContextMenu = useCallback(
    (event: MouseEvent) => {
      // Skip if another handler already claimed this event (e.g. ImageContextMenu)
      if (event.defaultPrevented) return;

      const target = event.target as HTMLElement;
      const link = target.closest("a.editor-link");
      if (link && onEditLink) {
        const pos = editor.view.posAtCoords({
          left: event.clientX,
          top: event.clientY,
        });
        if (!pos) return;

        event.preventDefault();
        editor.chain().setTextSelection(pos.pos).extendMarkRange("link").run();
        onEditLink();
        return;
      }

      const pos = editor.view.posAtCoords({
        left: event.clientX,
        top: event.clientY,
      });
      if (!pos) return;

      event.preventDefault();

      // --- Block index for "Inspect in HTML" ---
      const resolved = editor.state.doc.resolve(pos.pos);
      let blockNode = resolved;

      for (let depth = resolved.depth; depth > 0; depth--) {
        const node = resolved.node(depth);
        if (node.isBlock) {
          blockNode = editor.state.doc.resolve(resolved.before(depth));
          break;
        }
      }

      let blockCount = 0;
      let blockFound = false;
      editor.state.doc.descendants((node, nodePos) => {
        if (blockFound) return false;
        if (node.isBlock && node.isLeaf === false && node.childCount >= 0) {
          if (nodePos <= blockNode.pos) {
            blockCount++;
          }
          if (nodePos === blockNode.pos) {
            blockFound = true;
            return false;
          }
        }
      });

      // --- Check misspelling ---
      const misspelling = editor.storage.spellCheck?.getMisspellingAt?.(pos.pos) ?? null;

      // --- Word under cursor (for dictionary lookup) ---
      let wordUnderCursor: string | null = null;
      if (misspelling) {
        wordUnderCursor = misspelling.word;
      } else {
        const extracted = getWordAtPosition(editor.state.doc, pos.pos);
        wordUnderCursor = extracted?.word ?? null;
      }

      // --- Markdown detection (selection, or current block if no selection) ---
      const selection = editor.state.selection;
      let mdFrom: number;
      let mdTo: number;
      if (!selection.empty) {
        mdFrom = selection.from;
        mdTo = selection.to;
      } else {
        const $pos = editor.state.doc.resolve(pos.pos);
        mdFrom = $pos.depth >= 1 ? $pos.before(1) : 0;
        mdTo = $pos.depth >= 1 ? $pos.after(1) : editor.state.doc.content.size;
      }
      const mdText = editor.state.doc
        .textBetween(mdFrom, mdTo, "\n", "\n")
        .replace(/^\n+|\n+$/g, "");
      const markdown = looksLikeMarkdown(mdText) ? { from: mdFrom, to: mdTo, text: mdText } : null;

      const menuPosition = clampPosition(event.clientX, event.clientY);

      const menuId = ++menuIdCounter;
      setMenu({
        id: menuId,
        position: menuPosition,
        blockIndex: blockCount,
        misspelling,
        suggestions: [],
        isLoadingSuggestions: !!misspelling,
        wordUnderCursor,
        canPaste: false,
        hasFormatting: false,
        markdown,
      });

      void consumeProbe().then(({ canPaste, hasFormatting }) => {
        if (!canPaste && !hasFormatting) return;
        setMenu((prev) => {
          if (!prev || prev.id !== menuId) return prev;
          return { ...prev, canPaste, hasFormatting };
        });
      });

      // Async fetch suggestions if misspelled
      if (misspelling) {
        void spellCheckService.suggest(misspelling.word).then((suggestions) => {
          setMenu((prev) => {
            if (
              !prev ||
              prev.misspelling?.word !== misspelling.word ||
              prev.misspelling?.from !== misspelling.from
            ) {
              return prev;
            }
            return { ...prev, suggestions, isLoadingSuggestions: false };
          });
        });
      }
    },
    [editor, consumeProbe, onEditLink]
  );

  // Register contextmenu listener (bubble phase). The pointerdown listener for
  // the clipboard probe is owned by useClipboardProbe.
  useEffect(() => {
    const dom = editor.view.dom;
    dom.addEventListener("contextmenu", handleContextMenu);
    return () => dom.removeEventListener("contextmenu", handleContextMenu);
  }, [editor, handleContextMenu]);

  // Close on outside click, scroll, or escape
  useEffect(() => {
    if (!menu) return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (menuRef.current?.contains(event.target as Node)) {
        return;
      }
      close();
    };
    const handleScroll = () => close();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("scroll", handleScroll, true);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("scroll", handleScroll, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menu, close]);

  // Adjust position if overflowing viewport
  useEffect(() => {
    if (!menu || !menuRef.current) return;

    const rect = menuRef.current.getBoundingClientRect();
    const adjusted = adjustPosition(menu.position, rect);

    if (adjusted.left !== menu.position.left || adjusted.top !== menu.position.top) {
      setMenu((prev) => (prev ? { ...prev, position: adjusted } : prev));
    }
  }, [menu]);

  if (!menu) return null;

  const topSuggestions = menu.suggestions.slice(0, 5);
  const hasMisspelling = !!menu.misspelling;

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-50 w-56 max-h-[60vh] rounded-lg border border-border bg-card shadow-lg flex flex-col py-1"
      style={{ top: menu.position.top, left: menu.position.left }}
    >
      {/* Paste & Copy buttons */}
      <div className="flex justify-between">
        <button
          type="button"
          onClick={() => {
            const { from, to } = editor.state.selection;
            const hasSelection = from !== to;
            if (hasSelection) {
              // Trigger the same path as Ctrl+C
              editor.commands.focus();
              document.execCommand("copy");
            } else {
              navigator.clipboard.writeText(menu.wordUnderCursor ?? "");
            }
            close();
          }}
          className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors flex items-center gap-2"
        >
          <ClipboardCopy className="w-4 h-4 shrink-0" />
          <span className="truncate">{t("common.copy")}</span>
        </button>
        <button
          type="button"
          disabled={!menu.canPaste}
          onClick={() => {
            // Trigger the same path as Ctrl+V: PasteHandler/default
            // ProseMirror paste runs via the synchronous paste event.
            editor.commands.focus();
            const ok = document.execCommand("paste");
            if (!ok) {
              void fallbackPaste(editor);
            }
            close();
          }}
          className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
        >
          <ClipboardPaste className="w-4 h-4 shrink-0" />
          <span className="truncate">{t("common.paste")}</span>
        </button>
      </div>
      {menu.hasFormatting && (
        <button
          type="button"
          onClick={() => {
            void pasteWithoutFormatting(editor);
            close();
          }}
          className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors flex items-center gap-2"
        >
          <RemoveFormatting className="w-4 h-4 shrink-0" />
          <span className="truncate">{t("editor.pasteWithoutFormatting")}</span>
        </button>
      )}
      <Divider />
      {/* Spelling section */}
      {hasMisspelling && (
        <>
          <div className="px-3 py-1.5 border-b border-border">
            <p className="text-xs text-muted-foreground truncate">{menu.misspelling!.word}</p>
          </div>

          <div className="py-1">
            {menu.isLoadingSuggestions ? (
              <div className="px-3 py-1.5 text-sm text-muted-foreground">{t("common.loading")}</div>
            ) : topSuggestions.length > 0 ? (
              topSuggestions.map((suggestion) => (
                <button
                  type="button"
                  key={suggestion}
                  onClick={() => {
                    editor
                      .chain()
                      .focus()
                      .insertContentAt(
                        {
                          from: menu.misspelling!.from,
                          to: menu.misspelling!.to,
                        },
                        suggestion
                      )
                      .run();
                    close();
                  }}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors"
                >
                  {suggestion}
                </button>
              ))
            ) : (
              <div className="px-3 py-1.5 text-sm text-muted-foreground">
                {t("editor.noSuggestions")}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              editor.commands.addToDictionary(menu.misspelling!.word);
              close();
            }}
            className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors"
          >
            {t("editor.addToDictionary")}
          </button>

          <div className="border-t border-border my-1" />
        </>
      )}

      {/* Dictionary lookup */}
      {menu.wordUnderCursor && (
        <button
          type="button"
          onClick={() => {
            onLookup(menu.wordUnderCursor!);
            close();
          }}
          className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors flex items-center gap-2"
        >
          <BookOpen className="w-4 h-4 shrink-0" />
          <span className="truncate">{t("editor.lookUp", { word: menu.wordUnderCursor })}</span>
        </button>
      )}

      {/* Format as Markdown — only when the text looks like Markdown */}
      {menu.markdown && (
        <button
          type="button"
          className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors flex items-center gap-2"
          onClick={() => {
            const { from, to, text } = menu.markdown!;
            const html = markdownToEditorHtml(text);
            editor.chain().focus().insertContentAt({ from, to }, html).run();
            close();
          }}
        >
          <Sparkles className="w-4 h-4 shrink-0" />
          <span className="truncate">{t("editor.formatAsMarkdown")}</span>
        </button>
      )}

      {/* Inspect in HTML */}
      <button
        type="button"
        className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors flex items-center justify-between gap-2"
        onClick={() => {
          onInspect(menu.blockIndex);
          close();
        }}
      >
        <span className="flex items-center gap-2">
          <Code2 className="w-4 h-4 shrink-0" />
          {t("editor.inspectInHtml")}
        </span>
      </button>
    </div>,
    document.body
  );
}
