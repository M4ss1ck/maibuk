import { useEffect, useState, useRef, useCallback } from "react";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import { useModalStore } from "@/components/ui/modal-store";
import { FormattingButtons } from "@/components/editor/FormattingButtons";
import { deriveFloatingGroupIds } from "@/features/settings/toolbar-config";
import { useSettingsStore } from "@/features/settings/store";

interface SelectionToolbarProps {
  editor: Editor;
  onLinkClick: () => void;
}

interface Position {
  top: number;
  left: number;
}

export function SelectionToolbar({ editor, onLinkClick }: SelectionToolbarProps) {
  const [position, setPosition] = useState<Position | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  const editorState = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      hasSelection: !e.state.selection.empty && !(e.state.selection instanceof NodeSelection),
    }),
  });

  const isAnyModalOpen = useModalStore((s) => s.openCount > 0);
  const toolbarConfig = useSettingsStore((state) => state.toolbarConfig);
  const hasFloatingGroups = deriveFloatingGroupIds(toolbarConfig).length > 0;

  const updatePosition = useCallback(() => {
    if (!editor || editor.state.selection.empty) {
      setPosition(null);
      return;
    }

    const { from, to } = editor.state.selection;
    const start = editor.view.coordsAtPos(from);
    const end = editor.view.coordsAtPos(to);

    // Position above the selection, centered
    const containerRect = editor.view.dom.closest(".overflow-auto")?.getBoundingClientRect();
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

  if (
    !editorState.hasSelection ||
    !position ||
    isAnyModalOpen ||
    !hasFloatingGroups
  ) {
    return null;
  }

  return (
    <div
      ref={toolbarRef}
      className="fixed z-50 flex items-center gap-0.5 px-1.5 py-1 bg-card border border-border rounded-lg shadow-lg selection-toolbar-enter"
      style={{ top: `${position.top}px`, left: `${position.left}px` }}
    >
      <FormattingButtons editor={editor} onLinkClick={onLinkClick} />
    </div>
  );
}
