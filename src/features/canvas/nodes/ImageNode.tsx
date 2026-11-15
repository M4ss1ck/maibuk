import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ImageIcon, Minus, Plus, Type } from "lucide-react";
import { NodeResizeControl, type Node, type NodeProps } from "@xyflow/react";
import { useCanvasStore } from "@/features/canvas/store";
import { CANVAS_IMAGE_MIN_EDGE, scaleCanvasImageSize } from "@/features/canvas/imageEncoding";
import type { CanvasFlowNodeData } from "@/features/canvas/reactFlowAdapter";
import type { ImageCanvasNode } from "@/features/canvas/types";
import { CanvasNodeHandles } from "@/features/canvas/nodes/CanvasNodeHandles";
import { useCanvasNodeMenu } from "@/features/canvas/nodes/CanvasNodeMenu";
import type { ItemAction } from "@/components/ui";

type ImageFlowNode = Node<CanvasFlowNodeData, "image">;

const CORNERS = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;

/** The size a Canvas Image takes when scaled by a factor, its short edge held at the minimum. */
function scaleImage(node: ImageCanvasNode, factor: number) {
  return scaleCanvasImageSize({ width: node.width, height: node.height }, factor);
}

export function ImageNode({ data, selected }: NodeProps<ImageFlowNode>) {
  const { t } = useTranslation();
  const node = data.node;
  const editorReadOnly = useCanvasStore((state) => state.editorReadOnly);
  const interactivityLocked = useCanvasStore((state) => state.interactivityLocked);
  const beginLiveChange = useCanvasStore((state) => state.beginLiveChange);
  const resizeImageNodeLive = useCanvasStore((state) => state.resizeImageNodeLive);
  const endLiveChange = useCanvasStore((state) => state.endLiveChange);
  const updateImageNode = useCanvasStore((state) => state.updateImageNode);
  const openImageDialog = useCanvasStore((state) => state.openImageDialog);
  // The src whose data did not decode. Stored data that no longer decodes
  // (corrupt sync data) keeps its box and Connections and says so; a
  // replacement picture clears it, since it is a different src.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  // The node menu is a hook, so it is set up before the guard below narrows
  // the node: a Canvas Image lists these between Connect and Delete.
  const extraActions: ItemAction[] =
    node.kind === "image"
      ? [
          {
            id: "replace-image",
            label: t("canvas.replaceImage"),
            icon: ImageIcon,
            commandId: "canvasNode.replaceImage",
            onAction: () => openImageDialog({ kind: "replace", nodeId: node.id }),
          },
          {
            id: "edit-alt-text",
            label: t("canvas.editAltText"),
            icon: Type,
            commandId: "canvasNode.editAltText",
            onAction: () => openImageDialog({ kind: "altText", nodeId: node.id }),
          },
          {
            id: "image-larger",
            label: t("canvas.imageLarger"),
            icon: Plus,
            commandId: "canvasNode.imageLarger",
            onAction: () => updateImageNode(node.id, scaleImage(node, 1.1)),
          },
          {
            id: "image-smaller",
            label: t("canvas.imageSmaller"),
            icon: Minus,
            commandId: "canvasNode.imageSmaller",
            onAction: () => updateImageNode(node.id, scaleImage(node, 1 / 1.1)),
          },
        ]
      : [];
  const nodeMenu = useCanvasNodeMenu(node.id, {
    isDisabled: editorReadOnly || interactivityLocked,
    extraActions,
  });

  if (node.kind !== "image") return null;

  const resizable = !editorReadOnly && !interactivityLocked;

  return (
    <div
      ref={nodeMenu.setOwnerRef}
      {...nodeMenu.itemProps}
      className={`group relative rounded-md text-foreground pointer-coarse:select-none pointer-coarse:[-webkit-touch-callout:none] ${
        selected ? "ring-2 ring-primary/40" : ""
      }`}
      style={{ width: node.width, height: node.height }}
    >
      <CanvasNodeHandles connectedSides={data.connectedSides} variant="text" selected={selected} />
      {nodeMenu.menu}

      {failedSrc === node.src ? (
        <div
          role="img"
          aria-label={t("canvas.imageUnavailable")}
          className="flex h-full w-full items-center justify-center rounded-md border border-border bg-muted p-2 text-center text-xs text-muted-foreground"
        >
          {t("canvas.imageUnavailable")}
        </div>
      ) : (
        <img
          src={node.src}
          alt={node.alt || node.fileName || t("canvas.image")}
          draggable={false}
          className="h-full w-full object-contain"
          onError={() => setFailedSrc(node.src)}
        />
      )}

      {resizable &&
        CORNERS.map((position) => (
          // The picture never crops, so both edges hold the same floor: the
          // aspect ratio then keeps the short edge at the minimum.
          <NodeResizeControl
            key={position}
            position={position}
            keepAspectRatio
            minWidth={CANVAS_IMAGE_MIN_EDGE}
            minHeight={CANVAS_IMAGE_MIN_EDGE}
            className={`nodrag z-0! h-2! w-2! rounded-sm! border-0! bg-primary! transition-opacity ${
              selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            }`}
            onResizeStart={beginLiveChange}
            onResize={(_event, params) =>
              resizeImageNodeLive(node.id, {
                position: { x: params.x, y: params.y },
                width: params.width,
                height: params.height,
              })
            }
            onResizeEnd={endLiveChange}
          />
        ))}
    </div>
  );
}
