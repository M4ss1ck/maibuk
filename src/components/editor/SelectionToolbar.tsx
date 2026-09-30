import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import { FocusScope, useFocusManager, type FocusManager } from "react-aria";
import { Toolbar } from "react-aria-components";
import { useTranslation } from "react-i18next";
import { useModalStore } from "@/components/ui/modal-store";
import { FormattingButtons } from "@/components/editor/FormattingButtons";
import { deriveFloatingGroupIds } from "@/features/settings/toolbar-config";
import { useSettingsStore } from "@/features/settings/store";
import { useShortcuts } from "@/lib/shortcuts";

interface SelectionToolbarProps {
  editor: Editor;
  onLinkClick: () => void;
}

interface Position {
  top: number;
  left: number;
}

/**
 * Hands the enclosing FocusScope's focus manager to the toolbar's key handling:
 * the manager is only reachable from inside the scope.
 */
function FocusManagerBridge({ managerRef }: { managerRef: RefObject<FocusManager | null> }) {
  managerRef.current = useFocusManager() ?? null;
  return null;
}

export function SelectionToolbar({ editor, onLinkClick }: SelectionToolbarProps) {
  const { t } = useTranslation();
  const [position, setPosition] = useState<Position | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const focusManagerRef = useRef<FocusManager | null>(null);

  const editorState = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      hasSelection: !e.state.selection.empty && !(e.state.selection instanceof NodeSelection),
      // The Command reaches the bubble from the text, so it works only while
      // the text has focus. Focus arrives as a transaction, so this is live.
      isFocused: e.isFocused,
    }),
  });

  const isAnyModalOpen = useModalStore((s) => s.openCount > 0);
  const toolbarConfig = useSettingsStore((state) => state.toolbarConfig);
  const hasFloatingGroups = deriveFloatingGroupIds(toolbarConfig).length > 0;

  const isVisible = editorState.hasSelection && position !== null && !isAnyModalOpen && hasFloatingGroups;

  /** Whether the bubble itself holds focus, so a command must not move it away. */
  const toolbarHasFocus = useCallback(
    () => toolbarRef.current?.contains(document.activeElement) === true,
    []
  );

  const updatePosition = useCallback(() => {
    if (!editor || editor.state.selection.empty) {
      setPosition(null);
      return;
    }

    // Position above the selection, centered
    const containerRect = editor.view.dom.closest(".overflow-auto")?.getBoundingClientRect();
    if (!containerRect) {
      setPosition(null);
      return;
    }

    // While the toolbar holds focus it keeps its last place: a selection that
    // scrolled out of view must not take away the control the author is using.
    if (toolbarHasFocus()) return;

    const { from, to } = editor.state.selection;
    const start = editor.view.coordsAtPos(from);
    const end = editor.view.coordsAtPos(to);

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
  }, [editor, toolbarHasFocus]);

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

  // A command from the bubble leaves focus where it is; the main toolbar's
  // commands pull it back into the text.
  const shouldFocusEditor = useCallback(() => !toolbarHasFocus(), [toolbarHasFocus]);

  // Focus the first control that can be operated, so the keyboard reaches the
  // toolbar's commands without a pointer.
  const focusFirstControl = useCallback(() => {
    focusManagerRef.current?.focusFirst();
  }, []);

  // Keys come from the Command registry and the author's Custom Shortcuts.
  useShortcuts([
    {
      id: "editor.focusSelectionToolbar",
      enabled: isVisible && editorState.isFocused,
      allowInInput: true,
      onTrigger: focusFirstControl,
    },
  ]);

  if (!isVisible) {
    return null;
  }

  return (
    <div
      className="fixed z-50 selection-toolbar-enter"
      style={{ top: `${position.top}px`, left: `${position.left}px` }}
      onKeyDownCapture={(event) => {
        // A picker portaled out of the bubble (a color) still bubbles through
        // React, but it owns its own keys.
        if (!event.currentTarget.contains(event.target as Node)) return;
        if (event.key === "Home" || event.key === "End") {
          // React Aria's Toolbar handles the arrows but has no Home/End, so the
          // walk goes through its focus manager, which skips disabled controls.
          event.preventDefault();
          event.stopPropagation();
          if (event.key === "Home") focusManagerRef.current?.focusFirst();
          else focusManagerRef.current?.focusLast();
          return;
        }
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        // Back to the text with the selection the toolbar was acting on.
        editor.commands.focus();
      }}
      onMouseDown={(event) => {
        // A pointer press keeps focus in the text; only the keyboard Command
        // moves focus into the bubble.
        if (event.currentTarget.contains(event.target as Node)) event.preventDefault();
      }}
    >
      <Toolbar
        ref={toolbarRef}
        orientation="horizontal"
        aria-label={t("editor.selectionToolbar")}
        className="flex items-center gap-0.5 px-1.5 py-1 bg-card border border-border rounded-lg shadow-lg"
      >
        <FocusScope>
          <FocusManagerBridge managerRef={focusManagerRef} />
          <FormattingButtons
            editor={editor}
            onLinkClick={onLinkClick}
            shouldFocusEditor={shouldFocusEditor}
          />
        </FocusScope>
      </Toolbar>
    </div>
  );
}
