import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ImageInsertDialog } from "@/components/editor/ImageInsertDialog";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import {
  CanvasImageError,
  encodeCanvasImage,
  type EncodedCanvasImage,
} from "@/features/canvas/encodeCanvasImage";
import { fitCanvasImageSize, scaleCanvasImageSize } from "@/features/canvas/imageEncoding";
import { useCanvasStore } from "@/features/canvas/store";
import type { CanvasImageDialogTarget, ImageCanvasNode } from "@/features/canvas/types";

type PlaceTarget = Extract<CanvasImageDialogTarget, { kind: "place" }>;
type ReplaceTarget = Extract<CanvasImageDialogTarget, { kind: "replace" }>;

/** The file name a picture chosen by URL carries: its last path segment, decoded. */
function fileNameFromSource(source: string): string | undefined {
  if (!/^https?:\/\//i.test(source)) return undefined;
  try {
    const segment = new URL(source).pathname.split("/").filter(Boolean).pop();
    return segment ? decodeURIComponent(segment) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The size a replaced picture takes: the node's current long edge, with the new
 * picture's aspect ratio, never below the minimum short edge.
 */
function sizeKeepingLongEdge(
  node: ImageCanvasNode,
  picture: EncodedCanvasImage
): { width: number; height: number } {
  const longEdge = Math.max(node.width, node.height);
  const ratio = picture.width / picture.height;
  const size =
    picture.width >= picture.height
      ? { width: longEdge, height: longEdge / ratio }
      : { width: longEdge * ratio, height: longEdge };
  return scaleCanvasImageSize(
    { width: Math.round(size.width), height: Math.round(size.height) },
    1
  );
}

/** Placing or replacing a Canvas Image: the Chapter image dialog plus the encode step. */
function CanvasImageInsertDialog({
  target,
  onClose,
}: {
  target: PlaceTarget | ReplaceTarget;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const nodes = useCanvasStore((state) => state.doc.nodes);
  const addNode = useCanvasStore((state) => state.addNode);
  const selectNode = useCanvasStore((state) => state.selectNode);
  const updateImageNode = useCanvasStore((state) => state.updateImageNode);

  const handleSubmit = async (image: { src: string; alt: string; fileName?: string }) => {
    let encoded: EncodedCanvasImage;
    try {
      encoded = await encodeCanvasImage(image.src);
    } catch (error) {
      if (!(error instanceof CanvasImageError)) throw error;
      throw new Error(
        error.reason === "fetch" ? t("canvas.imageFetchFailed") : t("canvas.imageUnsupported")
      );
    }
    const fileName = image.fileName ?? fileNameFromSource(image.src);

    if (target.kind === "place") {
      const id = crypto.randomUUID();
      addNode({
        id,
        kind: "image",
        src: encoded.src,
        ...fitCanvasImageSize(encoded.width, encoded.height),
        position: target.position,
        alt: image.alt.trim() || undefined,
        fileName,
      });
      selectNode(id);
      return;
    }

    const node = nodes.find((candidate) => candidate.id === target.nodeId);
    if (!node || node.kind !== "image") return;
    updateImageNode(target.nodeId, {
      src: encoded.src,
      fileName,
      alt: image.alt,
      ...sizeKeepingLongEdge(node, encoded),
    });
  };

  return (
    <ImageInsertDialog
      isOpen
      title={target.kind === "place" ? t("canvas.addImage") : t("canvas.replaceImage")}
      onClose={onClose}
      onSubmit={handleSubmit}
    />
  );
}

/** The alt text a screen reader announces for a Canvas Image. */
function CanvasAltTextDialog({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const updateImageNode = useCanvasStore((state) => state.updateImageNode);
  const storedAlt = useCanvasStore((state) => {
    const node = state.doc.nodes.find((candidate) => candidate.id === nodeId);
    return node?.kind === "image" ? (node.alt ?? "") : "";
  });
  const [alt, setAlt] = useState(storedAlt);

  const save = () => {
    updateImageNode(nodeId, { alt });
    onClose();
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={t("canvas.editAltText")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={save}>{t("common.save")}</Button>
        </>
      }
    >
      <Input
        autoFocus
        label={t("canvas.altText")}
        value={alt}
        onChange={(event) => setAlt(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            save();
          }
        }}
      />
    </Modal>
  );
}

/** The Canvas Image dialog, mounted once by the Canvas page and opened through the store. */
export function CanvasImageDialog() {
  const target = useCanvasStore((state) => state.imageDialog);
  const closeImageDialog = useCanvasStore((state) => state.closeImageDialog);

  if (!target) return null;
  if (target.kind === "altText") {
    return <CanvasAltTextDialog nodeId={target.nodeId} onClose={closeImageDialog} />;
  }
  return <CanvasImageInsertDialog target={target} onClose={closeImageDialog} />;
}
