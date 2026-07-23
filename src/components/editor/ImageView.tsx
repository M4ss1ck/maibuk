import { useRef, useState, useCallback, useEffect } from "react";
import { NodeViewWrapper, NodeViewContent } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import { Toolbar } from "react-aria-components/Toolbar";
import { AlignLeft, AlignCenter, AlignRight, Minus, Plus, Trash2 } from "lucide-react";
import { NodeSelection } from "@tiptap/pm/state";
import { Button, Tooltip } from "@/components/ui";

const HANDLES = ["nw", "ne", "sw", "se"] as const;
const MIN_WIDTH_PERCENT = 10;
const MAX_WIDTH_PERCENT = 100;
const WIDTH_STEP_PERCENT = 10;

interface ResizeSession {
  pointerId: number;
  target: HTMLElement;
  previousCursor: string;
  previousUserSelect: string;
  onPointerMove: (event: PointerEvent) => void;
  onPointerUp: (event: PointerEvent) => void;
  onPointerCancel: (event: PointerEvent) => void;
  onLostPointerCapture: (event: PointerEvent) => void;
}

let activeResize: { owner: symbol; cancel: () => void } | null = null;

function normalizeImageWidth(value: unknown): number {
  if (typeof value !== "string") return MAX_WIDTH_PERCENT;
  const match = value.match(/^\s*(\d+(?:\.\d+)?)%\s*$/);
  if (!match) return MAX_WIDTH_PERCENT;
  const width = Number(match[1]);
  if (!Number.isFinite(width)) return MAX_WIDTH_PERCENT;
  return Math.min(Math.max(width, MIN_WIDTH_PERCENT), MAX_WIDTH_PERCENT);
}

export function ImageView({
  node,
  editor,
  getPos,
  updateAttributes,
  deleteNode,
  selected,
}: NodeViewProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [resizingWidth, setResizingWidth] = useState<string | null>(null);
  const resizingWidthRef = useRef<string | null>(null);
  const resizeSessionRef = useRef<ResizeSession | null>(null);
  const resizeOwnerRef = useRef(Symbol("image-resize"));
  const updateAttributesRef = useRef(updateAttributes);

  // Keep ref in sync for use in event handlers
  useEffect(() => {
    resizingWidthRef.current = resizingWidth;
  }, [resizingWidth]);

  useEffect(() => {
    updateAttributesRef.current = updateAttributes;
  }, [updateAttributes]);

  // Migrate legacy caption attribute into node content once.
  useEffect(() => {
    const legacyCaption = node.attrs.caption as string | undefined;
    if (!legacyCaption || node.textContent.trim().length > 0) {
      return;
    }

    const pos = typeof getPos === "function" ? getPos() : null;
    if (typeof pos !== "number") {
      return;
    }

    const tr = editor.state.tr;
    tr.insertText(legacyCaption, pos + 1);
    tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      caption: "",
    });
    editor.view.dispatch(tr);
  }, [editor, getPos, node.attrs, node.textContent]);

  // Convert ephemeral blob: URLs to persistent data URLs.
  useEffect(() => {
    const src = node.attrs.src as string | null;
    if (!src || !src.startsWith("blob:")) return;

    let cancelled = false;

    (async () => {
      try {
        const response = await fetch(src);
        const blob = await response.blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        if (!cancelled) {
          updateAttributes({ src: dataUrl });
        }
      } catch {
        // Blob URL is already expired — nothing we can do
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [node.attrs.src, updateAttributes]);

  const handleCaptionKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Prevent Enter from creating newlines in caption
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  const finishResize = useCallback((commit: boolean) => {
    const session = resizeSessionRef.current;
    if (!session) return;
    resizeSessionRef.current = null;
    if (activeResize?.owner === resizeOwnerRef.current) {
      activeResize = null;
    }

    document.removeEventListener("pointermove", session.onPointerMove);
    document.removeEventListener("pointerup", session.onPointerUp);
    document.removeEventListener("pointercancel", session.onPointerCancel);
    session.target.removeEventListener("lostpointercapture", session.onLostPointerCapture);
    if (session.target.hasPointerCapture?.(session.pointerId)) {
      session.target.releasePointerCapture(session.pointerId);
    }
    document.body.style.cursor = session.previousCursor;
    document.body.style.userSelect = session.previousUserSelect;

    if (commit && resizingWidthRef.current) {
      updateAttributesRef.current({ width: resizingWidthRef.current });
    }
    setResizingWidth(null);
    resizingWidthRef.current = null;
  }, []);

  useEffect(() => () => finishResize(false), [finishResize]);

  const handleResizeStart = useCallback(
    (handle: (typeof HANDLES)[number], e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (resizeSessionRef.current) return;
      e.preventDefault();
      e.stopPropagation();

      const figureEl = containerRef.current;
      if (!figureEl) return;

      const directParent = figureEl.parentElement;
      const fallbackParent =
        directParent?.tagName === "FIGURE" ? directParent.parentElement : directParent;
      const parentEl = figureEl.closest(".editor-content, .ProseMirror") || fallbackParent;
      if (!parentEl) return;

      activeResize?.cancel();

      const containerWidth = parentEl.getBoundingClientRect().width;
      const startWidth = figureEl.getBoundingClientRect().width;
      const startX = e.clientX;
      const isLeft = handle === "nw" || handle === "sw";
      const pointerId = e.pointerId;
      const target = e.currentTarget;

      const onPointerMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        const dx = moveEvent.clientX - startX;
        const effectiveDx = isLeft ? -dx : dx;
        // Multiply by 2 because the image is centered, so moving one side effectively doubles the visual change
        const newWidthPx = Math.max(startWidth + effectiveDx * 2, containerWidth * 0.1);
        const newWidthPercent = Math.min(Math.round((newWidthPx / containerWidth) * 100), 100);
        const widthStr = `${newWidthPercent}%`;
        setResizingWidth(widthStr);
        resizingWidthRef.current = widthStr;
      };

      const onPointerUp = (upEvent: PointerEvent) => {
        if (upEvent.pointerId === pointerId) finishResize(true);
      };
      const onPointerCancel = (cancelEvent: PointerEvent) => {
        if (cancelEvent.pointerId === pointerId) finishResize(false);
      };
      const onLostPointerCapture = (lostEvent: PointerEvent) => {
        if (lostEvent.pointerId === pointerId) finishResize(false);
      };

      resizeSessionRef.current = {
        pointerId,
        target,
        previousCursor: document.body.style.cursor,
        previousUserSelect: document.body.style.userSelect,
        onPointerMove,
        onPointerUp,
        onPointerCancel,
        onLostPointerCapture,
      };
      document.body.style.cursor = `${handle}-resize`;
      document.body.style.userSelect = "none";
      target.setPointerCapture(pointerId);
      document.addEventListener("pointermove", onPointerMove);
      document.addEventListener("pointerup", onPointerUp);
      document.addEventListener("pointercancel", onPointerCancel);
      target.addEventListener("lostpointercapture", onLostPointerCapture);
      activeResize = {
        owner: resizeOwnerRef.current,
        cancel: () => finishResize(false),
      };
    },
    [finishResize]
  );

  const handleImagePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (!editor.isEditable) return;
      e.preventDefault();
      e.stopPropagation();

      const pos = typeof getPos === "function" ? getPos() : null;
      if (typeof pos !== "number") return;

      const tr = editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos));
      editor.view.dispatch(tr);
    },
    [editor, getPos]
  );

  const currentWidth = normalizeImageWidth(node.attrs.width);
  const changeWidth = useCallback(
    (delta: number) => {
      const nextWidth = Math.min(
        Math.max(currentWidth + delta, MIN_WIDTH_PERCENT),
        MAX_WIDTH_PERCENT
      );
      if (nextWidth === currentWidth) return;
      updateAttributes({ width: `${nextWidth}%` });
    },
    [currentWidth, updateAttributes]
  );

  const alignment = node.attrs.alignment || "center";
  const width = resizingWidth || node.attrs.width || "100%";
  const isCaptionEmpty = node.textContent.trim().length === 0;

  return (
    <NodeViewWrapper
      as="figure"
      className={`editor-image-figure align-${alignment}`}
      style={{ width }}
      data-image=""
      data-alignment={alignment}
    >
      {/* Floating toolbar on selection */}
      {selected && (
        <div contentEditable={false}>
          <Toolbar
            className="image-floating-toolbar"
            orientation="horizontal"
            aria-label={t("editor.toolbar")}
          >
            <Tooltip content={t("editor.alignLeft")}>
              <button
                onClick={() => updateAttributes({ alignment: "left" })}
                className={alignment === "left" ? "active" : ""}
                aria-label={t("editor.alignLeft")}
                type="button"
              >
                <AlignLeft className="w-4 h-4" />
              </button>
            </Tooltip>
            <Tooltip content={t("editor.alignCenter")}>
              <button
                onClick={() => updateAttributes({ alignment: "center" })}
                className={alignment === "center" ? "active" : ""}
                aria-label={t("editor.alignCenter")}
                type="button"
              >
                <AlignCenter className="w-4 h-4" />
              </button>
            </Tooltip>
            <Tooltip content={t("editor.alignRight")}>
              <button
                onClick={() => updateAttributes({ alignment: "right" })}
                className={alignment === "right" ? "active" : ""}
                aria-label={t("editor.alignRight")}
                type="button"
              >
                <AlignRight className="w-4 h-4" />
              </button>
            </Tooltip>
            <div className="toolbar-divider" />
            <Tooltip content={t("editor.decreaseImageWidth")}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => changeWidth(-WIDTH_STEP_PERCENT)}
                aria-label={t("editor.decreaseImageWidth")}
                disabled={currentWidth <= MIN_WIDTH_PERCENT}
                type="button"
              >
                <Minus className="w-4 h-4" />
              </Button>
            </Tooltip>
            <Tooltip content={t("editor.increaseImageWidth")}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => changeWidth(WIDTH_STEP_PERCENT)}
                aria-label={t("editor.increaseImageWidth")}
                disabled={currentWidth >= MAX_WIDTH_PERCENT}
                type="button"
              >
                <Plus className="w-4 h-4" />
              </Button>
            </Tooltip>
            <div className="toolbar-divider" />
            <Tooltip content={t("common.delete")}>
              <button onClick={() => deleteNode()} aria-label={t("common.delete")} type="button">
                <Trash2 className="w-4 h-4" />
              </button>
            </Tooltip>
          </Toolbar>
        </div>
      )}

      {/* Image container with resize handles */}
      <div
        className="image-view-container"
        ref={containerRef}
        onPointerDown={handleImagePointerDown}
      >
        <img
          src={node.attrs.src}
          alt={node.attrs.alt || ""}
          title={node.attrs.title || undefined}
          draggable={false}
        />

        {/* Resize handles */}
        {selected &&
          HANDLES.map((handle) => (
            <div
              key={handle}
              className={`image-resize-handle ${handle}`}
              onPointerDown={(e) => handleResizeStart(handle, e)}
            />
          ))}
      </div>

      {/* Editable caption */}
      <NodeViewContent
        // as="figcaption"
        className="image-caption"
        data-placeholder={t("editor.imageCaptionPlaceholder")}
        data-empty={isCaptionEmpty ? "true" : "false"}
        onKeyDownCapture={handleCaptionKeyDown}
      />
    </NodeViewWrapper>
  );
}
