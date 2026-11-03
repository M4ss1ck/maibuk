import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import { ArrowDownToLine, ArrowUpToLine } from "lucide-react";
import { canMoveChecked } from "@/components/editor/extensions/TaskListOrder";
import { ItemActionsMenu, type ItemAction } from "@/components/ui/ItemActionsMenu";

function TaskListMenu({ editor, slot }: { editor: Editor; slot: HTMLElement }) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (open) return;
    // The author goes back to the text. Checked a frame later, once the move
    // has landed: a close on blur leaves focus where the author moved it.
    requestAnimationFrame(() => {
      if (editor.isDestroyed) return;
      const active = document.activeElement;
      if (!active || active === document.body || slot.contains(active)) editor.commands.focus();
    });
  };

  // Read when opened: the slot's position changes with every edit before it.
  const pos = isOpen ? editor.view.posAtDOM(slot, 0) : 0;
  const actions: ItemAction[] = isOpen
    ? [
        {
          id: "move-checked-top",
          label: t("editor.moveCheckedToTop"),
          icon: ArrowUpToLine,
          commandId: "editor.moveCheckedToTop",
          isDisabled: !canMoveChecked(editor.state.doc, pos, "top"),
          onAction: () => editor.commands.moveCheckedToTop(pos),
        },
        {
          id: "move-checked-bottom",
          label: t("editor.moveCheckedToBottom"),
          icon: ArrowDownToLine,
          commandId: "editor.moveCheckedToBottom",
          isDisabled: !canMoveChecked(editor.state.doc, pos, "bottom"),
          onAction: () => editor.commands.moveCheckedToBottom(pos),
        },
      ]
    : [];

  return (
    <ItemActionsMenu
      label={t("editor.taskListActions")}
      actions={actions}
      isOpen={isOpen}
      onOpenChange={handleOpenChange}
    />
  );
}

/** The ⋯ button of each outermost Task List, portaled into the slots `TaskListOrder` decorates. */
export function TaskListMenus({ editor }: { editor: Editor | null }) {
  const [slots, setSlots] = useState<HTMLElement[]>([]);

  useEffect(() => {
    if (!editor) return;
    const sync = () => {
      if (editor.isDestroyed) return;
      const found = editor.view.dom?.querySelectorAll<HTMLElement>("[data-task-list-menu]");
      const next = found ? Array.from(found) : [];
      setSlots((prev) =>
        prev.length === next.length && prev.every((slot, index) => slot === next[index])
          ? prev
          : next
      );
    };
    sync();
    editor.on("create", sync);
    editor.on("transaction", sync);
    return () => {
      editor.off("create", sync);
      editor.off("transaction", sync);
    };
  }, [editor]);

  if (!editor) return null;
  return (
    <>
      {slots.map((slot) =>
        createPortal(<TaskListMenu editor={editor} slot={slot} />, slot, slot.dataset.taskListMenu)
      )}
    </>
  );
}
