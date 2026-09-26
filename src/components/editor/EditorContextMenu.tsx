import { useState, useEffect, useCallback, useRef } from "react";
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
import {
  Header,
  Menu,
  MenuItem,
  MenuSection,
  MenuTrigger,
  Popover,
  Separator,
} from "react-aria-components";
import { spellCheckService } from "@/lib/spellcheck";
import { looksLikeMarkdown, markdownToEditorHtml } from "@/features/markdown";
import {
  clampPosition,
  getWordAtPosition,
} from "@/components/editor/editor-context-menu-utils";
import type { ClipboardProbe } from "@/components/editor/useClipboardProbe";
import {
  fallbackPaste,
  pasteWithoutFormatting,
  probeClipboard,
  useClipboardProbe,
} from "@/components/editor/useClipboardProbe";

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

const MENU_ITEM_CLASS =
  "flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-foreground outline-none data-focused:bg-muted";

/**
 * Unified context menu for the WYSIWYG editor.
 * Combines spell-check suggestions, dictionary lookup, and "Inspect in HTML"
 * into a single menu. Opens from a right click at the pointer or from
 * Shift+F10 / the ContextMenu key at the caret (React Aria menu).
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
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const consumeProbe = useClipboardProbe(editor);

  // Notify parent when open state changes
  useEffect(() => {
    onOpenChange?.(menu !== null);
  }, [menu, onOpenChange]);

  const close = useCallback(() => setMenu(null), []);

  const openMenuAt = useCallback(
    (
      pos: number,
      position: { top: number; left: number },
      probe?: () => Promise<ClipboardProbe>
    ) => {
      let blockCount = 0;
      let blockFound = false;
      const blockNode = (() => {
        const resolved = editor.state.doc.resolve(pos);
        for (let depth = resolved.depth; depth > 0; depth--) {
          const node = resolved.node(depth);
          if (node.isBlock) {
            return editor.state.doc.resolve(resolved.before(depth));
          }
        }
        return resolved;
      })();
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
      const misspelling = editor.storage.spellCheck?.getMisspellingAt?.(pos) ?? null;

      // --- Word under cursor (for dictionary lookup) ---
      let wordUnderCursor: string | null = null;
      if (misspelling) {
        wordUnderCursor = misspelling.word;
      } else {
        const extracted = getWordAtPosition(editor.state.doc, pos);
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
        const $pos = editor.state.doc.resolve(pos);
        mdFrom = $pos.depth >= 1 ? $pos.before(1) : 0;
        mdTo = $pos.depth >= 1 ? $pos.after(1) : editor.state.doc.content.size;
      }
      const mdText = editor.state.doc
        .textBetween(mdFrom, mdTo, "\n", "\n")
        .replace(/^\n+|\n+$/g, "");
      const markdown = looksLikeMarkdown(mdText) ? { from: mdFrom, to: mdTo, text: mdText } : null;

      const menuId = ++menuIdCounter;
      setMenu({
        id: menuId,
        position,
        blockIndex: blockCount,
        misspelling,
        suggestions: [],
        isLoadingSuggestions: !!misspelling,
        wordUnderCursor,
        canPaste: false,
        hasFormatting: false,
        markdown,
      });

      const probePromise = probe
        ? probe().catch(() => ({ canPaste: false, hasFormatting: false }))
        : consumeProbe();
      void probePromise.then(({ canPaste, hasFormatting }) => {
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
    [editor, consumeProbe]
  );

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
      openMenuAt(pos.pos, clampPosition(event.clientX, event.clientY));
    },
    [editor, openMenuAt, onEditLink]
  );

  // Register contextmenu listener (bubble phase). The pointerdown listener for
  // the clipboard probe is owned by useClipboardProbe.
  useEffect(() => {
    const dom = editor.view.dom;
    dom.addEventListener("contextmenu", handleContextMenu);
    return () => dom.removeEventListener("contextmenu", handleContextMenu);
  }, [editor, handleContextMenu]);

  // Shift+F10 / the ContextMenu key opens the same menu at the caret.
  useEffect(() => {
    const dom = editor.view.dom;
    const handleKeyDown = (event: KeyboardEvent) => {
      const isContextMenuKey = event.key === "ContextMenu";
      const isShiftF10 = event.shiftKey && event.key === "F10";
      if (!isContextMenuKey && !isShiftF10) return;

      event.preventDefault();
      const pos = editor.state.selection.from;
      let position = { top: 0, left: 0 };
      try {
        const coords = editor.view.coordsAtPos(pos);
        position = clampPosition(coords.left, coords.bottom + 4);
      } catch {
        // jsdom has no layout; the menu still opens for the keyboard.
      }
      openMenuAt(pos, position, probeClipboard);
    };

    dom.addEventListener("keydown", handleKeyDown);
    return () => dom.removeEventListener("keydown", handleKeyDown);
  }, [editor, openMenuAt]);

  // Scroll moves the menu away from its anchor: close it like before.
  useEffect(() => {
    if (!menu) return;
    const handleScroll = () => close();
    document.addEventListener("scroll", handleScroll, true);
    return () => document.removeEventListener("scroll", handleScroll, true);
  }, [menu, close]);

  const handleAction = (key: React.Key) => {
    if (!menu) return;
    const id = String(key);

    if (id.startsWith("suggestion:")) {
      const suggestion = menu.suggestions[Number(id.slice("suggestion:".length))];
      if (suggestion && menu.misspelling) {
        editor
          .chain()
          .focus()
          .insertContentAt(
            { from: menu.misspelling.from, to: menu.misspelling.to },
            suggestion
          )
          .run();
      }
      close();
      return;
    }

    switch (id) {
      case "copy": {
        const { from, to } = editor.state.selection;
        if (from !== to) {
          // Trigger the same path as Ctrl+C
          editor.commands.focus();
          document.execCommand("copy");
        } else {
          void navigator.clipboard.writeText(menu.wordUnderCursor ?? "");
        }
        break;
      }
      case "paste": {
        // Trigger the same path as Ctrl+V: PasteHandler/default
        // ProseMirror paste runs via the synchronous paste event.
        editor.commands.focus();
        const ok = document.execCommand("paste");
        if (!ok) {
          void fallbackPaste(editor);
        }
        break;
      }
      case "paste-plain":
        void pasteWithoutFormatting(editor);
        break;
      case "add-to-dictionary":
        if (menu.misspelling) {
          editor.commands.addToDictionary(menu.misspelling.word);
        }
        break;
      case "look-up":
        if (menu.wordUnderCursor) {
          onLookup(menu.wordUnderCursor);
        }
        break;
      case "format-markdown": {
        if (menu.markdown) {
          const { from, to, text } = menu.markdown;
          const html = markdownToEditorHtml(text);
          editor.chain().focus().insertContentAt({ from, to }, html).run();
        }
        break;
      }
      case "inspect-html":
        onInspect(menu.blockIndex);
        break;
    }
    close();
  };

  const topSuggestions = menu?.suggestions.slice(0, 5) ?? [];
  const hasMisspelling = !!menu?.misspelling;

  return (
    <>
      {/* A zero-size anchor at the pointer/caret: MenuTrigger positions the menu
          from it, and focus returns to the editor from onOpenChange below. */}
      <MenuTrigger
        isOpen={menu !== null}
        onOpenChange={(open) => {
          if (!open) {
            close();
            editor.commands.focus();
          }
        }}
      >
        <button
          ref={anchorRef}
          type="button"
          tabIndex={-1}
          aria-label={t("editor.contextMenu")}
          className="pointer-events-none fixed h-px w-px opacity-0"
          style={{ top: menu?.position.top ?? 0, left: menu?.position.left ?? 0 }}
        />
        <Popover placement="bottom start" className="z-50">
          <Menu
            aria-label={t("editor.contextMenu")}
            onAction={handleAction}
            className="flex max-h-[60vh] w-56 flex-col overflow-y-auto rounded-lg border border-border bg-card py-1 shadow-lg outline-none"
          >
            <MenuSection className="outline-none">
              <MenuItem id="copy" textValue={t("common.copy")} className={MENU_ITEM_CLASS}>
                <ClipboardCopy className="w-4 h-4 shrink-0" />
                <span className="truncate">{t("common.copy")}</span>
              </MenuItem>
              <MenuItem
                id="paste"
                isDisabled={!menu?.canPaste}
                textValue={t("common.paste")}
                className={`${MENU_ITEM_CLASS} data-disabled:opacity-50`}
              >
                <ClipboardPaste className="w-4 h-4 shrink-0" />
                <span className="truncate">{t("common.paste")}</span>
              </MenuItem>
              {menu?.hasFormatting && (
                <MenuItem
                  id="paste-plain"
                  textValue={t("editor.pasteWithoutFormatting")}
                  className={MENU_ITEM_CLASS}
                >
                  <RemoveFormatting className="w-4 h-4 shrink-0" />
                  <span className="truncate">{t("editor.pasteWithoutFormatting")}</span>
                </MenuItem>
              )}
            </MenuSection>

            {hasMisspelling && menu.misspelling && (
              <>
                <Separator className="my-1 border-t border-border" />
                <MenuSection className="outline-none">
                  <Header className="truncate px-3 py-1.5 text-xs text-muted-foreground">
                    {menu.misspelling.word}
                  </Header>
                  {menu.isLoadingSuggestions ? (
                    <MenuItem
                      id="suggestions-loading"
                      isDisabled
                      textValue={t("common.loading")}
                      className={MENU_ITEM_CLASS}
                    >
                      {t("common.loading")}
                    </MenuItem>
                  ) : topSuggestions.length > 0 ? (
                    topSuggestions.map((suggestion, index) => (
                      <MenuItem
                        key={suggestion}
                        id={`suggestion:${index}`}
                        textValue={suggestion}
                        className={MENU_ITEM_CLASS}
                      >
                        {suggestion}
                      </MenuItem>
                    ))
                  ) : (
                    <MenuItem
                      id="suggestions-none"
                      isDisabled
                      textValue={t("editor.noSuggestions")}
                      className={MENU_ITEM_CLASS}
                    >
                      {t("editor.noSuggestions")}
                    </MenuItem>
                  )}
                  <MenuItem
                    id="add-to-dictionary"
                    textValue={t("editor.addToDictionary")}
                    className={MENU_ITEM_CLASS}
                  >
                    {t("editor.addToDictionary")}
                  </MenuItem>
                </MenuSection>
              </>
            )}

            {menu?.wordUnderCursor && (
              <>
                <Separator className="my-1 border-t border-border" />
                <MenuItem
                  id="look-up"
                  textValue={t("editor.lookUp", { word: menu.wordUnderCursor })}
                  className={MENU_ITEM_CLASS}
                >
                  <BookOpen className="w-4 h-4 shrink-0" />
                  <span className="truncate">
                    {t("editor.lookUp", { word: menu.wordUnderCursor })}
                  </span>
                </MenuItem>
              </>
            )}

            {menu?.markdown && (
              <MenuItem
                id="format-markdown"
                textValue={t("editor.formatAsMarkdown")}
                className={MENU_ITEM_CLASS}
              >
                <Sparkles className="w-4 h-4 shrink-0" />
                <span className="truncate">{t("editor.formatAsMarkdown")}</span>
              </MenuItem>
            )}

            <Separator className="my-1 border-t border-border" />
            <MenuItem
              id="inspect-html"
              textValue={t("editor.inspectInHtml")}
              className={MENU_ITEM_CLASS}
            >
              <Code2 className="w-4 h-4 shrink-0" />
              {t("editor.inspectInHtml")}
            </MenuItem>
          </Menu>
        </Popover>
      </MenuTrigger>
    </>
  );
}
