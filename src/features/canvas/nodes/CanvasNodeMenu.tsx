import { useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Copy, ExternalLink, Spline, Trash2 } from "lucide-react";
import { ItemActionsPopover, toast } from "@/components/ui";
import type { ItemAction } from "@/components/ui";
import { useItemContextMenu } from "@/hooks/useItemContextMenu";
import { useItemCommands } from "@/hooks/useItemCommands";
import { usePluginItemMenuActions } from "@/hooks/usePluginItemMenuActions";
import { useCanvasStore } from "@/features/canvas/store";

/** A Link in a Text Node, offered by its Item Menu. */
export interface CanvasNodeLink {
  href: string;
  text: string;
}

interface CanvasNodeMenuOptions {
  /** Disables the node's own actions; Link entries still reach the author. */
  isDisabled: boolean;
  links?: CanvasNodeLink[];
  /**
   * The Link under the pointer at the context-menu gesture, set by the node
   * before it opens the menu. Read only for a pointer open: a keyboard or
   * long-press gesture never landed on a Link.
   */
  contextLinkRef?: RefObject<CanvasNodeLink | null>;
  /** Follows a Link from the menu: internal targets navigate, external ones confirm. */
  onOpenLink?: (link: CanvasNodeLink, index: number) => void;
}

function linkActions(
  t: TFunction,
  links: CanvasNodeLink[],
  contextLink: CanvasNodeLink | null,
  onOpenLink: NonNullable<CanvasNodeMenuOptions["onOpenLink"]>
): ItemAction[] {
  if (contextLink) {
    const index = links.findIndex(
      (link) => link.href === contextLink.href && link.text === contextLink.text
    );
    return [
      // command-exempt: opening a Link is a navigation, not a bindable Command.
      {
        id: "link-open",
        label: t("editor.openLink"),
        icon: ExternalLink,
        onAction: () => onOpenLink(contextLink, index),
      },
      // command-exempt: copying a Link's URL is a navigation aid, not a Command.
      {
        id: "link-copy",
        label: t("editor.copyUrl"),
        icon: Copy,
        onAction: () => void copyLinkToClipboard(contextLink.href, t),
      },
    ];
  }

  if (links.length === 1) {
    return [
      // command-exempt: opening a Link is a navigation, not a bindable Command.
      {
        id: "link-open-0",
        label: t("editor.openLink"),
        icon: ExternalLink,
        onAction: () => onOpenLink(links[0], 0),
      },
    ];
  }

  // command-exempt: opening a Link is a navigation, not a bindable Command.
  return links.map((link, index) => ({
    id: `link-open-${index}`,
    label: t("canvas.openLinkNamed", { text: link.text }),
    icon: ExternalLink,
    onAction: () => onOpenLink(link, index),
  }));
}

async function copyLinkToClipboard(url: string, t: TFunction) {
  try {
    await navigator.clipboard.writeText(url);
    toast.success(t("common.copied"));
  } catch (e) {
    console.error("Failed to copy link:", e);
  }
}

/**
 * Long-press (touch) or right click on a Canvas node opens its Item Menu,
 * anchored to the node: no ⋯ button on every node. A Text Node also lists its
 * Links, which is the keyboard and touch route to a Link that has no pointer.
 */
export function useCanvasNodeMenu(
  nodeId: string,
  { isDisabled, links = [], contextLinkRef, onOpenLink = () => undefined }: CanvasNodeMenuOptions
) {
  const { t } = useTranslation();
  const anchorRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  // The Link the open gesture pointed at. Cleared for any open that did not
  // come from the pointer, and when the menu closes.
  const [contextLink, setContextLink] = useState<CanvasNodeLink | null>(null);
  const selectNode = useCanvasStore((state) => state.selectNode);
  const removeNode = useCanvasStore((state) => state.removeNode);
  const openConnectPicker = useCanvasStore((state) => state.openConnectPicker);
  const buildPluginActions = usePluginItemMenuActions("canvasNode");
  const nodeActions: ItemAction[] = [
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
    ...buildPluginActions({ kind: "canvasNode", id: nodeId }),
  ];
  const actions = [
    ...linkActions(t, links, contextLink, onOpenLink),
    ...(isDisabled ? [] : nodeActions),
  ];
  const { itemProps, setOwnerRef } = useItemContextMenu({
    // Without an action there is nothing to show: a read-only Text Node with no
    // Links still swallows the browser menu, but opens none of its own.
    isDisabled: actions.length === 0,
    anchorRef,
    onOpen: (source) => {
      setContextLink(source === "pointer" ? (contextLinkRef?.current ?? null) : null);
      selectNode(nodeId);
      setIsOpen(true);
    },
  });
  useItemCommands(anchorRef, actions, { enabled: !isDisabled });

  const menu = (
    <ItemActionsPopover
      triggerRef={anchorRef}
      label={t("canvas.nodeActions")}
      isOpen={isOpen}
      onOpenChange={(open) => {
        setIsOpen(open);
        if (!open) setContextLink(null);
      }}
      actions={actions}
    />
  );

  return { anchorRef, setOwnerRef, itemProps, menu };
}
