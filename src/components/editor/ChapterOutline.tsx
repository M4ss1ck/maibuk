import type { Editor } from "@tiptap/core";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Tooltip } from "@/components/ui";

interface OutlineItem {
  pos: number;
  type: "heading" | "sceneBreak";
  level: number; // 1-3 for headings, 0 for scene breaks
  text: string;
}

function buildOutline(editor: Editor): OutlineItem[] {
  const items: OutlineItem[] = [];
  editor.state.doc.forEach((node, offset) => {
    if (node.type.name === "heading") {
      items.push({
        pos: offset,
        type: "heading",
        level: typeof node.attrs.level === "number" ? node.attrs.level : 1,
        text: node.textContent.trim(),
      });
    } else if (node.type.name === "sceneBreak") {
      items.push({ pos: offset, type: "sceneBreak", level: 0, text: "" });
    }
  });
  return items;
}

// The marker the caret currently sits within: the last one at or before the cursor.
function findActivePos(editor: Editor): number | null {
  const { from } = editor.state.selection;
  let active: number | null = null;
  editor.state.doc.forEach((node, offset) => {
    if ((node.type.name === "heading" || node.type.name === "sceneBreak") && offset <= from) {
      active = offset;
    }
  });
  return active;
}

interface ChapterOutlineProps {
  editor: Editor;
}

/**
 * Outline (headings + scene breaks) of the chapter currently open in the editor.
 * Rendered inline beneath the active chapter in the chapter list.
 */
export function ChapterOutline({ editor }: ChapterOutlineProps) {
  const { t } = useTranslation();
  const [items, setItems] = useState<OutlineItem[]>(() => buildOutline(editor));
  const [activePos, setActivePos] = useState<number | null>(() => findActivePos(editor));
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const updateItems = () => setItems(buildOutline(editor));
    const updateActive = () => setActivePos(findActivePos(editor));

    updateItems();
    updateActive();

    editor.on("update", updateItems);
    editor.on("update", updateActive);
    editor.on("selectionUpdate", updateActive);

    return () => {
      editor.off("update", updateItems);
      editor.off("update", updateActive);
      editor.off("selectionUpdate", updateActive);
    };
  }, [editor]);

  if (items.length === 0) return null;

  // Move focus between heading buttons with the arrow keys instead of letting
  // the browser scroll the list container.
  const handleArrowKeys = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const buttons = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []
    );
    if (buttons.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "ArrowDown"
        ? Math.min(current + 1, buttons.length - 1)
        : Math.max((current < 0 ? buttons.length : current) - 1, 0);
    buttons[next]?.focus();
  };

  const navigate = (pos: number) => {
    const dom = editor.view.nodeDOM(pos);
    const el = dom instanceof HTMLElement ? dom : (dom?.parentElement ?? null);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    editor.commands.setTextSelection(pos + 1);
  };

  return (
    <ul ref={listRef} className="py-1 pr-2" onKeyDown={handleArrowKeys}>
      {items.map((item) => {
        const isActive = activePos === item.pos;
        if (item.type === "sceneBreak") {
          return (
            <li key={item.pos}>
              <Tooltip content={t("toc.sceneBreak")}>
                <button
                  type="button"
                  onClick={() => navigate(item.pos)}
                  style={{ paddingLeft: "1.75rem" }}
                  className={`w-full text-left py-0.5 rounded text-xs italic tracking-widest transition-colors ${
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground/70 hover:bg-muted/50"
                  }`}
                >
                  * * *
                </button>
              </Tooltip>
            </li>
          );
        }
        return (
          <li key={item.pos}>
            <button
              type="button"
              onClick={() => navigate(item.pos)}
              style={{ paddingLeft: `${1.75 + (item.level - 1) * 0.75}rem` }}
              className={`block w-full text-left py-0.5 pr-1 rounded text-xs truncate transition-colors ${
                isActive
                  ? "bg-primary/10 text-primary font-medium"
                  : item.level === 1
                    ? "text-foreground/80 hover:bg-muted/50"
                    : "text-muted-foreground hover:bg-muted/50"
              }`}
            >
              {item.text || t("toc.untitledHeading")}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
