import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Spline, Trash2 } from "lucide-react";
import { ItemActionsPopover } from "@/components/ui";
import type { ItemAction } from "@/components/ui";
import { useItemContextMenu } from "@/hooks/useItemContextMenu";
import { useItemCommands } from "@/hooks/useItemCommands";
import { useCanvasStore } from "@/features/canvas/store";

/**
 * Long-press (touch) or right click on a Canvas node opens its Item Menu,
 * anchored to the node: no ⋯ button on every node.
 */
export function useCanvasNodeMenu(nodeId: string, { isDisabled }: { isDisabled: boolean }) {
  const { t } = useTranslation();
  const anchorRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const selectNode = useCanvasStore((state) => state.selectNode);
  const removeNode = useCanvasStore((state) => state.removeNode);
  const openConnectPicker = useCanvasStore((state) => state.openConnectPicker);
  const { itemProps } = useItemContextMenu({
    isDisabled,
    onOpen: () => {
      selectNode(nodeId);
      setIsOpen(true);
    },
  });
  const actions: ItemAction[] = [
    {
      id: "connect",
      label: t("canvas.connectTo"),
      icon: Spline,
      commandId: "canvasNode.connect",
      onAction: () => openConnectPicker(nodeId),
    },
    {
      id: "delete",
      label: t("common.delete"),
      icon: Trash2,
      isDestructive: true,
      commandId: "canvasNode.delete",
      onAction: () => removeNode(nodeId),
    },
  ];
  useItemCommands(anchorRef, actions, { enabled: !isDisabled });

  const menu = (
    <ItemActionsPopover
      triggerRef={anchorRef}
      label={t("canvas.nodeActions")}
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      actions={actions}
    />
  );

  return { anchorRef, itemProps, menu };
}
