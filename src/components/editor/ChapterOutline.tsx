import type { Editor } from "@tiptap/core";
import { useEffect, useState } from "react";
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

  const navigate = (pos: number) => {
    const dom = editor.view.nodeDOM(pos);
    const el = dom instanceof HTMLElement ? dom : (dom?.parentElement ?? null);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    editor.commands.setTextSelection(pos + 1);
  };

  return (
    <ul className="py-1 pr-2">
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
