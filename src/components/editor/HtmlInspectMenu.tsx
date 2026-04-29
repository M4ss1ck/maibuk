import { useState, useEffect, useCallback, useRef } from "react";
import type { Editor } from "@tiptap/react";
import { useTranslation } from "react-i18next";

interface HtmlInspectMenuProps {
  editor: Editor;
  onInspect: (blockIndex: number) => void;
}

/**
 * Context menu item "Inspect in HTML" for the WYSIWYG editor.
 * Uses bubble phase (after ImageContextMenu's capture phase,
 * before SpellCheckPopover's bubble phase — registered first).
 */
export function HtmlInspectMenu({ editor, onInspect }: HtmlInspectMenuProps) {
  const { t } = useTranslation();
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [blockIndex, setBlockIndex] = useState<number>(-1);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleContextMenu = useCallback(
    (event: MouseEvent) => {
      // Skip if another handler already claimed this event (e.g. ImageContextMenu)
      if (event.defaultPrevented) return;

      // Get the ProseMirror position from click coordinates
      const pos = editor.view.posAtCoords({
        left: event.clientX,
        top: event.clientY,
      });
      if (!pos) return;

      // Walk up to nearest block node and count block index
      const resolved = editor.state.doc.resolve(pos.pos);
      let blockNode = resolved;

      // Find the nearest block-level ancestor
      for (let depth = resolved.depth; depth > 0; depth--) {
        const node = resolved.node(depth);
        if (node.isBlock) {
          blockNode = editor.state.doc.resolve(resolved.before(depth));
          break;
        }
      }

      // Count block nodes in document order up to this position
      let count = 0;
      let found = false;
      editor.state.doc.descendants((node, nodePos) => {
        if (found) return false;
        if (node.isBlock && node.isLeaf === false && node.childCount >= 0) {
          // Count top-level and nested block nodes
          if (nodePos <= blockNode.pos) {
            count++;
          }
          if (nodePos === blockNode.pos) {
            found = true;
            return false;
          }
        }
      });

      setBlockIndex(count);
      event.preventDefault();
      setMenuPos({ x: event.clientX, y: event.clientY });
    },
    [editor],
  );

  useEffect(() => {
    const dom = editor.view.dom;
    // Bubble phase — runs after ImageContextMenu (capture) but we handle it
    dom.addEventListener("contextmenu", handleContextMenu);
    return () => dom.removeEventListener("contextmenu", handleContextMenu);
  }, [editor, handleContextMenu]);

  // Close menu on outside click
  useEffect(() => {
    if (!menuPos) return;
    const handleClick = () => setMenuPos(null);
    const handleScroll = () => setMenuPos(null);
    document.addEventListener("click", handleClick);
    document.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("click", handleClick);
      document.removeEventListener("scroll", handleScroll, true);
    };
  }, [menuPos]);

  if (!menuPos) return null;

  return (
    <div
      ref={menuRef}
      className="fixed z-50 bg-card border border-border rounded-md shadow-md py-1 min-w-40"
      style={{ left: menuPos.x, top: menuPos.y }}
    >
      <button
        type="button"
        className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors flex items-center justify-between gap-4"
        onClick={() => {
          onInspect(blockIndex);
          setMenuPos(null);
        }}
      >
        <span>{t("editor.inspectInHtml")}</span>
        <span className="text-xs text-muted-foreground">Ctrl+Shift+U</span>
      </button>
    </div>
  );
}

/**
 * Given a block index (from document order) and raw HTML string,
 * find the character offset of the corresponding tag.
 */
export function findBlockOffsetInHtml(
  html: string,
  blockIndex: number,
): { from: number; to: number } | null {
  const blockTags = new Set([
    "p",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "ul",
    "ol",
    "li",
    "blockquote",
    "table",
    "tr",
    "td",
    "th",
    "thead",
    "tbody",
    "tfoot",
    "div",
    "section",
    "article",
    "pre",
    "figure",
    "figcaption",
    "details",
    "summary",
    "dl",
    "dt",
    "dd",
    "nav",
    "aside",
    "main",
    "header",
    "footer",
  ]);

  const tagRegex = /<([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g;
  let match = tagRegex.exec(html);
  let count = 0;

  while (match !== null) {
    const tagName = match[1].toLowerCase();
    if (blockTags.has(tagName)) {
      count++;
      if (count === blockIndex) {
        // Find the end of this block (closing tag or next block)
        const closeTag = `</${tagName}>`;
        const closeIdx = html.indexOf(closeTag, match.index);
        const to =
          closeIdx !== -1
            ? closeIdx + closeTag.length
            : match.index + match[0].length;
        return { from: match.index, to };
      }
    }
    match = tagRegex.exec(html);
  }

  return null;
}
