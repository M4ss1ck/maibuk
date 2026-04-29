import { useEffect, useState, useRef, useCallback } from "react";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import { ToolbarButton, Divider } from "./ToolbarButton";
import { useModalStore } from "../ui/modal-store";
import { useTranslation } from "react-i18next";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Highlighter,
  Link,
  Code,
  Heading1,
  Heading2,
  Heading3,
} from "lucide-react";

interface SelectionToolbarProps {
  editor: Editor;
  onLinkClick: () => void;
}

interface Position {
  top: number;
  left: number;
}

export function SelectionToolbar({ editor, onLinkClick }: SelectionToolbarProps) {
  const { t } = useTranslation();
  const [position, setPosition] = useState<Position | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  const editorState = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      isBold: e.isActive("bold"),
      isItalic: e.isActive("italic"),
      isUnderline: e.isActive("underline"),
      isStrike: e.isActive("strike"),
      isHighlight: e.isActive("highlight"),
      isLink: e.isActive("link"),
      isCode: e.isActive("code"),
      isH1: e.isActive("heading", { level: 1 }),
      isH2: e.isActive("heading", { level: 2 }),
      isH3: e.isActive("heading", { level: 3 }),
      hasSelection: !e.state.selection.empty && !(e.state.selection instanceof NodeSelection),
    }),
  });

  const isAnyModalOpen = useModalStore((s) => s.openCount > 0);

  const updatePosition = useCallback(() => {
    if (!editor || editor.state.selection.empty) {
      setPosition(null);
      return;
    }

    const { from, to } = editor.state.selection;
    const start = editor.view.coordsAtPos(from);
    const end = editor.view.coordsAtPos(to);

    // Position above the selection, centered
    const containerRect = editor.view.dom
      .closest(".overflow-auto")
      ?.getBoundingClientRect();
    if (!containerRect) {
      setPosition(null);
      return;
    }

    const bubbleTop = start.top - 48;

    // Hide when the bubble would render above the editor's visible area
    // (which would put it under the sticky EditorToolbar) or when the
    // selection has scrolled below the visible area.
    if (bubbleTop < containerRect.top || start.top > containerRect.bottom) {
      setPosition(null);
      return;
    }

    const toolbarWidth = toolbarRef.current?.offsetWidth || 320;
    const centerX = (start.left + end.left) / 2;
    const left = Math.max(
      containerRect.left + 8,
      Math.min(centerX - toolbarWidth / 2, containerRect.right - toolbarWidth - 8)
    );

    setPosition({
      top: bubbleTop,
      left,
    });
  }, [editor]);

  useEffect(() => {
    if (!editor) return;

    const onSelectionUpdate = () => {
      // Small delay to let the DOM settle after selection change
      requestAnimationFrame(updatePosition);
    };

    editor.on("selectionUpdate", onSelectionUpdate);
    return () => {
      editor.off("selectionUpdate", onSelectionUpdate);
    };
  }, [editor, updatePosition]);

  // Re-evaluate position on scroll: hides when selection leaves view,
  // re-shows when it scrolls back in.
  useEffect(() => {
    const scrollContainer = editor?.view.dom.closest(".overflow-auto");
    if (!scrollContainer) return;

    scrollContainer.addEventListener("scroll", updatePosition, { passive: true });
    return () => scrollContainer.removeEventListener("scroll", updatePosition);
  }, [editor, updatePosition]);

  if (!editorState.hasSelection || !position || isAnyModalOpen) return null;

  return (
    <div
      ref={toolbarRef}
      className="fixed z-50 flex items-center gap-0.5 px-1.5 py-1 bg-card border border-border rounded-lg shadow-lg selection-toolbar-enter"
      style={{ top: `${position.top}px`, left: `${position.left}px` }}
    >
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        isActive={editorState.isBold}
        title={t("editor.bold")}
      >
        <Bold className="w-3.5 h-3.5" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        isActive={editorState.isItalic}
        title={t("editor.italic")}
      >
        <Italic className="w-3.5 h-3.5" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        isActive={editorState.isUnderline}
        title={t("editor.underline")}
      >
        <Underline className="w-3.5 h-3.5" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleStrike().run()}
        isActive={editorState.isStrike}
        title={t("editor.strikethrough")}
      >
        <Strikethrough className="w-3.5 h-3.5" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHighlight({ color: "#FFFF00" }).run()}
        isActive={editorState.isHighlight}
        title={t("editor.highlight")}
      >
        <Highlighter className="w-3.5 h-3.5" />
      </ToolbarButton>

      <Divider />

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        isActive={editorState.isH1}
        title={t("editor.heading1")}
      >
        <Heading1 className="w-3.5 h-3.5" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        isActive={editorState.isH2}
        title={t("editor.heading2")}
      >
        <Heading2 className="w-3.5 h-3.5" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        isActive={editorState.isH3}
        title={t("editor.heading3")}
      >
        <Heading3 className="w-3.5 h-3.5" />
      </ToolbarButton>

      <Divider />

      <ToolbarButton
        onClick={onLinkClick}
        isActive={editorState.isLink}
        title={t("editor.insertLinkShortcut")}
      >
        <Link className="w-3.5 h-3.5" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleCode().run()}
        isActive={editorState.isCode}
        title={t("editor.code")}
      >
        <Code className="w-3.5 h-3.5" />
      </ToolbarButton>
    </div>
  );
}
