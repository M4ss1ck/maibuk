import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import { FocusScope, useFocusManager, type FocusManager } from "react-aria";
import { useToolbar } from "react-aria/useToolbar";
import { useTranslation } from "react-i18next";
import { useModalStore } from "@/components/ui/modal-store";
import { FormattingButtons } from "@/components/editor/FormattingButtons";
import { setSelectionKept } from "@/components/editor/extensions/SelectionKept";
import { liveSelectionToolbarIds } from "@/features/settings/toolbar-config";
import { useSettingsStore } from "@/features/settings/store";
import { useToolbarRegistryRevision } from "@/hooks/useToolbarRegistryRevision";
import { useShortcuts } from "@/lib/shortcuts";

interface SelectionToolbarProps {
  editor: Editor;
  onLinkClick: () => void;
}

interface Position {
  top: number;
  left: number;
  /** The bubble's widest allowed size, so a narrow editor scrolls its buttons. */
  maxWidth: number;
}

/** The text field a press or a key landed on, or null for any other control. */
export function textFieldOf(
  target: EventTarget | null
): HTMLInputElement | HTMLTextAreaElement | null {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return target;
  return null;
}

/**
 * Hands the enclosing FocusScope's focus manager to the toolbar's key handling:
 * the manager is only reachable from inside the scope.
 */
function FocusManagerBridge({ managerRef }: { managerRef: RefObject<FocusManager | null> }) {
  managerRef.current = useFocusManager() ?? null;
  return null;
}

interface SelectionToolbarKeyboardOptions {
  editor: Editor;
  /** The React Aria Toolbar the arrows walk. */
  toolbarRef: RefObject<HTMLDivElement | null>;
  /** Whether the Command can reach the toolbar from the text right now. */
  enabled: boolean;
  /** The toolbar's own focus, so an enclosing editor can treat it as an overlay. */
  onFocusChange?: (focused: boolean) => void;
  /**
   * Focus left the toolbar for something other than its own controls, a
   * portaled list, or the text, reported during the blur itself: a press on a
   * Canvas can unmount the editor before any later callback runs.
   */
  onLeave?: () => void;
}

/**
 * The keyboard and pointer surface of a floating selection toolbar: the Command
 * that moves focus into it (Alt+F10 unless remapped), Home/End and the arrows
 * across its controls, Escape back to the text with the selection intact, the
 * decoration that keeps the range painted while focus is away, and a text field
 * that owns its own keys and caret. The editor's SelectionToolbar and a Text
 * Node's NodeFormatBubble share it so both offer the same behavior, and it hands
 * back `holdInView` so the bubble stays above an on-screen keyboard while a
 * field has focus.
 */
export function useSelectionToolbarKeyboard({
  editor,
  toolbarRef,
  enabled,
  onFocusChange,
  onLeave,
}: SelectionToolbarKeyboardOptions) {
  const focusManagerRef = useRef<FocusManager | null>(null);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A press on a field moves focus into the toolbar on purpose: the field must
  // keep it, and a change made from there must not pull the caret back out.
  const fieldPressRef = useRef(false);
  const [fieldFocused, setFieldFocused] = useState(false);
  const [visualView, setVisualView] = useState<{ top: number; bottom: number } | null>(null);
  const onFocusChangeRef = useRef(onFocusChange);
  onFocusChangeRef.current = onFocusChange;
  const onLeaveRef = useRef(onLeave);
  onLeaveRef.current = onLeave;

  /** Whether the toolbar itself holds focus, so a command must not move it away. */
  const toolbarHasFocus = useCallback(
    () => toolbarRef.current?.contains(document.activeElement) === true,
    [toolbarRef]
  );

  // Focus the first control that can be operated, so the keyboard reaches the
  // toolbar's commands without a pointer.
  const focusFirstControl = useCallback(() => {
    fieldPressRef.current = false;
    focusManagerRef.current?.focusFirst();
  }, []);

  // Keys come from the Command registry and the author's Custom Shortcuts.
  useShortcuts([
    {
      id: "editor.focusSelectionToolbar",
      enabled,
      allowInInput: true,
      onTrigger: focusFirstControl,
    },
  ]);

  const clearKept = useCallback(() => {
    // A dialog opened from the toolbar (Link) still acts on this range; the text regaining focus clears it.
    if (useModalStore.getState().openCount > 0) return;
    setSelectionKept(editor, false);
  }, [editor]);

  useEffect(() => {
    return () => {
      if (clearTimerRef.current !== null) {
        clearTimeout(clearTimerRef.current);
        clearTimerRef.current = null;
      }
      clearKept();
    };
  }, [editor, clearKept]);

  // A command from the toolbar leaves focus where it is; the main toolbar's
  // commands pull it back into the text. A press started on a field is a pointer
  // change, so its commit returns to the text as the Editor Toolbar's does.
  const shouldFocusEditor = useCallback(
    () => fieldPressRef.current || !toolbarHasFocus(),
    [toolbarHasFocus]
  );

  // On a phone the on-screen keyboard shrinks the visual viewport; the bubble
  // follows it while a field has focus so the author can see what is typed.
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!fieldFocused || !viewport) {
      setVisualView(null);
      return;
    }
    const update = () =>
      setVisualView({ top: viewport.offsetTop, bottom: viewport.offsetTop + viewport.height });
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, [fieldFocused]);

  const holdInView = useCallback(
    (top: number) => {
      if (!visualView) return top;
      const height = toolbarRef.current?.offsetHeight ?? 0;
      return Math.max(visualView.top + 8, Math.min(top, visualView.bottom - height - 8));
    },
    [visualView, toolbarRef]
  );

  const containerProps = {
    // The native selection is not painted while focus is in the toolbar, so
    // the range stays visible through the selection-kept decoration instead.
    onFocus: (event: ReactFocusEvent<HTMLElement>) => {
      if (clearTimerRef.current !== null) {
        clearTimeout(clearTimerRef.current);
        clearTimerRef.current = null;
      }
      setSelectionKept(editor, true);
      // A portaled picker's own field (a hex value) is not one of the toolbar's.
      setFieldFocused(
        event.currentTarget.contains(event.target) && textFieldOf(event.target) !== null
      );
      onFocusChangeRef.current?.(true);
    },
    onBlur: (event: ReactFocusEvent<HTMLElement>) => {
      const next = event.relatedTarget;
      if (
        !(next instanceof Element) ||
        (!event.currentTarget.contains(next) &&
          !next.closest('[role="listbox"]') &&
          !editor.view.dom.contains(next))
      ) {
        onLeaveRef.current?.();
      }
      clearTimerRef.current = setTimeout(() => {
        clearTimerRef.current = null;
        const active = document.activeElement;
        // Focus back inside the toolbar, or in a picker's portaled list, is not
        // the author leaving it: a window that loses focus reports no element
        // at all, and the picker is still acting on the selection.
        if (
          toolbarRef.current?.contains(active) ||
          (active instanceof Element && active.closest('[role="listbox"]'))
        ) {
          return;
        }
        fieldPressRef.current = false;
        setFieldFocused(false);
        clearKept();
        onFocusChangeRef.current?.(false);
      }, 0);
    },
    // A press on a field (or its chevron, or a list item) is the author reaching
    // for that control; every other press keeps focus in the text.
    onPointerDownCapture: (event: ReactPointerEvent<HTMLElement>) => {
      const target = event.target as Element | null;
      // A list item is portaled out of the toolbar; any other outside press
      // (a color picker) is not a field press.
      const inside = event.currentTarget.contains(target);
      if (!inside && !target?.closest('[role="listbox"]')) return;
      if (target?.closest('input, textarea, [role="listbox"], [aria-haspopup="listbox"]')) {
        fieldPressRef.current = true;
        // The text's blur arrives before the field's focus, in separate browser
        // events: a Text Node's bubble must already count as focused then, or it
        // unmounts under the press and focus falls to the page.
        onFocusChangeRef.current?.(true);
      }
    },
    // A finger that scrolls the bubble sideways never focuses the field it began on.
    onPointerCancelCapture: () => {
      if (!fieldPressRef.current || toolbarHasFocus()) return;
      fieldPressRef.current = false;
      onFocusChangeRef.current?.(false);
    },
    onKeyDownCapture: (event: ReactKeyboardEvent<HTMLElement>) => {
      // A picker portaled out of the toolbar (a color) still bubbles through
      // React, but it owns its own keys.
      if (!event.currentTarget.contains(event.target as Node)) return;
      const field = textFieldOf(event.target);
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        const forward = event.key === "ArrowRight";
        if (field) {
          const start = field.selectionStart ?? 0;
          const end = field.selectionEnd ?? start;
          const atEdge = forward ? end === field.value.length : start === 0;
          // A held modifier extends a selection and a caret inside the value
          // moves: the field keeps the arrow.
          const modified = event.shiftKey || event.ctrlKey || event.altKey || event.metaKey;
          if (modified || start !== end || !atEdge) return;
        }
        event.preventDefault();
        event.stopPropagation();
        fieldPressRef.current = false;
        const before = document.activeElement;
        if (forward) focusManagerRef.current?.focusNext({ tabbable: true });
        else focusManagerRef.current?.focusPrevious({ tabbable: true });
        // A field the walk lands in takes the caret on the edge it came from,
        // so crossing a field is one press in and one press out.
        if (document.activeElement !== before) {
          const landed = textFieldOf(document.activeElement);
          if (landed) {
            const position = forward ? landed.value.length : 0;
            landed.setSelectionRange(position, position);
          }
        }
        return;
      }
      if (event.key === "Home" || event.key === "End") {
        // The field owns its own Home and End, as any text field does.
        if (field) return;
        // React Aria's Toolbar has no Home/End, so the walk goes through its
        // focus manager, which skips disabled controls and the chevrons.
        event.preventDefault();
        event.stopPropagation();
        if (event.key === "Home") focusManagerRef.current?.focusFirst({ tabbable: true });
        else focusManagerRef.current?.focusLast({ tabbable: true });
        return;
      }
      if (event.key !== "Escape") return;
      // An open combobox list closes and discards its typing on this press.
      if (field?.getAttribute("aria-expanded") === "true") return;
      event.preventDefault();
      event.stopPropagation();
      // Back to the text with the selection the toolbar was acting on.
      editor.commands.focus();
    },
    onMouseDown: (event: ReactMouseEvent<HTMLElement>) => {
      // A pointer press keeps focus in the text, except on a text field, which
      // needs the caret a browser gives it.
      if (!event.currentTarget.contains(event.target as Node)) return;
      if (textFieldOf(event.target)) return;
      event.preventDefault();
    },
  };

  return {
    containerProps,
    fieldPressRef,
    focusManagerRef,
    shouldFocusEditor,
    toolbarHasFocus,
    holdInView,
  };
}

interface SelectionToolbarControlsProps {
  toolbarRef: RefObject<HTMLDivElement | null>;
  focusManagerRef: RefObject<FocusManager | null>;
  fieldPressRef: RefObject<boolean>;
  ariaLabel: string;
  className?: string;
  children: ReactNode;
}

/**
 * The toolbar's controls inside the Toolbar and FocusScope the keyboard
 * surface walks. A floating toolbar puts its own positioning around this.
 */
export function SelectionToolbarControls({
  toolbarRef,
  focusManagerRef,
  fieldPressRef,
  ariaLabel,
  className,
  children,
}: SelectionToolbarControlsProps) {
  const { toolbarProps } = useToolbar(
    { orientation: "horizontal", "aria-label": ariaLabel },
    toolbarRef
  );
  return (
    <div
      ref={toolbarRef}
      {...toolbarProps}
      className={className}
      onKeyDownCapture={(event) => {
        // The arrows are the selection toolbar's own: a field decides whether it
        // keeps Left and Right, so React Aria's walk must not see them at all.
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") return;
        toolbarProps.onKeyDownCapture?.(event);
      }}
      onFocusCapture={(event) => {
        // React Aria restores the last focused child when focus re-enters the
        // toolbar, which would steal a press on a field the author aimed at.
        if (fieldPressRef.current) return;
        toolbarProps.onFocusCapture?.(event);
      }}
    >
      <FocusScope>
        <FocusManagerBridge managerRef={focusManagerRef} />
        {children}
      </FocusScope>
    </div>
  );
}

export function SelectionToolbar({ editor, onLinkClick }: SelectionToolbarProps) {
  const { t } = useTranslation();
  const [position, setPosition] = useState<Position | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

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
  // Recompute entry liveness when Plugins register or unregister their buttons.
  useToolbarRegistryRevision();
  const hasFloatingGroups = liveSelectionToolbarIds(toolbarConfig).length > 0;

  const isVisible =
    editorState.hasSelection && position !== null && !isAnyModalOpen && hasFloatingGroups;

  const {
    containerProps,
    fieldPressRef,
    focusManagerRef,
    shouldFocusEditor,
    toolbarHasFocus,
    holdInView,
  } = useSelectionToolbarKeyboard({
    editor,
    toolbarRef,
    enabled: isVisible && editorState.isFocused,
  });

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

    // A narrow editor (a phone) keeps every button reachable by scrolling the
    // bubble instead of letting it run past the viewport.
    const maxWidth = Math.max(160, containerRect.width - 16);
    const bubbleTop = start.top - 48;

    // Hide when the bubble would render above the editor's visible area
    // (which would put it under the sticky EditorToolbar) or when the
    // selection has scrolled below the visible area.
    if (bubbleTop < containerRect.top || start.top > containerRect.bottom) {
      setPosition(null);
      return;
    }

    // Before the first paint the bubble is not in the DOM yet, so the cap is
    // the safest width to centre with; the measured width follows on the next
    // pass.
    const toolbarWidth = Math.min(toolbarRef.current?.offsetWidth || maxWidth, maxWidth);
    const centerX = (start.left + end.left) / 2;
    const left = Math.max(
      containerRect.left + 8,
      Math.min(centerX - toolbarWidth / 2, containerRect.right - toolbarWidth - 8)
    );

    setPosition({
      top: bubbleTop,
      left,
      maxWidth,
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

  // A window resize changes how much room the bubble has, so its width cap
  // must follow even when the selection itself did not move.
  useEffect(() => {
    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, [updatePosition]);

  // The first position is measured before the bubble exists. Re-measure after
  // the DOM mutation and before paint so the width cap and the left clamp use
  // the real size without a one-frame jump.
  useLayoutEffect(() => {
    if (!isVisible) return;
    updatePosition();
  }, [isVisible, updatePosition]);

  if (!isVisible) {
    return null;
  }

  return (
    <div
      className="fixed z-50 selection-toolbar-enter"
      style={{
        top: `${holdInView(position.top)}px`,
        left: `${position.left}px`,
        maxWidth: `${position.maxWidth}px`,
      }}
      {...containerProps}
    >
      <SelectionToolbarControls
        toolbarRef={toolbarRef}
        focusManagerRef={focusManagerRef}
        fieldPressRef={fieldPressRef}
        ariaLabel={t("editor.selectionToolbar")}
        className="flex items-center gap-0.5 overflow-x-auto px-1.5 py-1 bg-card border border-border rounded-lg shadow-lg"
      >
        <FormattingButtons
          editor={editor}
          onLinkClick={onLinkClick}
          shouldFocusEditor={shouldFocusEditor}
        />
      </SelectionToolbarControls>
    </div>
  );
}
