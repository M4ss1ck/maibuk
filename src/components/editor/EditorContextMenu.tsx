import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { DOMSerializer } from "@tiptap/pm/model";
import { useTranslation } from "react-i18next";
import { Code2, BookOpen, ClipboardCopy, ClipboardPaste } from "lucide-react";
import { spellCheckService } from "../../lib/spellcheck";
import { toast } from "../ui";
import { Divider } from "./ToolbarButton";

interface EditorContextMenuProps {
  editor: Editor;
  onInspect: (blockIndex: number) => void;
  onLookup: (word: string) => void;
  onOpenChange?: (open: boolean) => void;
}

type MenuState = {
  position: { top: number; left: number };
  blockIndex: number;
  misspelling: { word: string; from: number; to: number } | null;
  suggestions: string[];
  isLoadingSuggestions: boolean;
  wordUnderCursor: string | null;
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
  onOpenChange,
}: EditorContextMenuProps) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);

  // Notify parent when open state changes
  useEffect(() => {
    onOpenChange?.(menu !== null);
  }, [menu, onOpenChange]);

  const close = useCallback(() => setMenu(null), []);

  const handleContextMenu = useCallback(
    (event: MouseEvent) => {
      // Skip if another handler already claimed this event (e.g. ImageContextMenu)
      if (event.defaultPrevented) return;

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
      const misspelling =
        editor.storage.spellCheck?.getMisspellingAt?.(pos.pos) ?? null;

      // --- Word under cursor (for dictionary lookup) ---
      let wordUnderCursor: string | null = null;
      if (misspelling) {
        wordUnderCursor = misspelling.word;
      } else {
        const extracted = getWordAtPosition(editor.state.doc, pos.pos);
        wordUnderCursor = extracted?.word ?? null;
      }

      const menuPosition = clampPosition(event.clientX, event.clientY);

      setMenu({
        position: menuPosition,
        blockIndex: blockCount,
        misspelling,
        suggestions: [],
        isLoadingSuggestions: !!misspelling,
        wordUnderCursor,
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
    [editor],
  );

  // Register event listener (bubble phase)
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

    if (
      adjusted.left !== menu.position.left ||
      adjusted.top !== menu.position.top
    ) {
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
              const slice = editor.state.doc.slice(from, to);
              const serializer = DOMSerializer.fromSchema(editor.state.schema);
              const fragment = serializer.serializeFragment(slice.content);
              const container = document.createElement("div");
              container.appendChild(fragment);
              const html = container.innerHTML;
              const text = editor.state.doc.textBetween(from, to, "\n\n");
              navigator.clipboard.write([
                new ClipboardItem({
                  "text/html": new Blob([html], { type: "text/html" }),
                  "text/plain": new Blob([text], { type: "text/plain" }),
                }),
              ]);
            } else {
              navigator.clipboard.writeText(menu.wordUnderCursor ?? "");
            }
            toast.success(t("common.copied"));
            close();
          }}
          className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors flex items-center gap-2"
        >
          <ClipboardCopy className="w-4 h-4 shrink-0" />
          <span className="truncate">{t("common.copy")}</span>
        </button>
        <button
          type="button"
          onClick={async () => {
            try {
              const items = await navigator.clipboard.read();
              for (const item of items) {
                if (item.types.includes("text/html")) {
                  const blob = await item.getType("text/html");
                  const html = await blob.text();
                  editor.chain().focus().insertContent(html).run();
                  close();
                  return;
                }
              }
              // Fallback to plain text
              const text = await navigator.clipboard.readText();
              editor.chain().focus().insertContent(text).run();
            } catch {
              // clipboard.read() may not be available; fall back to readText
              const text = await navigator.clipboard.readText();
              editor.chain().focus().insertContent(text).run();
            }
            close();
          }}
          className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors flex items-center gap-2"
        >
          <ClipboardPaste className="w-4 h-4 shrink-0" />
          <span className="truncate">{t("common.paste")}</span>
        </button>
      </div>
      <Divider />
      {/* Spelling section */}
      {hasMisspelling && (
        <>
          <div className="px-3 py-1.5 border-b border-border">
            <p className="text-xs text-muted-foreground truncate">
              {menu.misspelling!.word}
            </p>
          </div>

          <div className="py-1">
            {menu.isLoadingSuggestions ? (
              <div className="px-3 py-1.5 text-sm text-muted-foreground">
                {t("common.loading")}
              </div>
            ) : topSuggestions.length > 0 ? (
              topSuggestions.map((suggestion) => (
                <button
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
                        suggestion,
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
          <span className="truncate">
            {t("editor.lookUp", { word: menu.wordUnderCursor })}
          </span>
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
    document.body,
  );
}

// --- Helpers ---

/**
 * Extract the word at a given ProseMirror position.
 * Uses Unicode-aware matching to support accented characters (Spanish, etc.).
 */
function getWordAtPosition(
  doc: import("@tiptap/pm/model").Node,
  pos: number,
): { word: string } | null {
  const $pos = doc.resolve(pos);
  const parent = $pos.parent;
  if (!parent.isTextblock) return null;

  const offset = $pos.parentOffset;
  const text = parent.textContent;

  const isWordChar = (ch: string) => /[\p{L}\p{M}'-]/u.test(ch);

  let start = offset;
  let end = offset;

  while (start > 0 && isWordChar(text[start - 1])) start--;
  while (end < text.length && isWordChar(text[end])) end++;

  if (start === end) return null;

  const word = text.slice(start, end);
  // Skip single-char punctuation-only results
  if (/^['-]+$/.test(word)) return null;

  return { word };
}

function clampPosition(clientX: number, clientY: number) {
  const width = 224;
  const height = 300;
  const padding = 8;
  const maxLeft = window.innerWidth - width - padding;
  const maxTop = window.innerHeight - height - padding;
  return {
    left: Math.min(Math.max(clientX, padding), Math.max(maxLeft, padding)),
    top: Math.min(Math.max(clientY, padding), Math.max(maxTop, padding)),
  };
}

function adjustPosition(
  position: { top: number; left: number },
  rect: DOMRect,
) {
  const padding = 8;
  const maxLeft = window.innerWidth - rect.width - padding;
  const maxTop = window.innerHeight - rect.height - padding;
  return {
    left: Math.min(
      Math.max(position.left, padding),
      Math.max(maxLeft, padding),
    ),
    top: Math.min(Math.max(position.top, padding), Math.max(maxTop, padding)),
  };
}
