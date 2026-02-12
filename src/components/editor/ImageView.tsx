import { useRef, useState, useCallback, useEffect } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import {
  AlignLeft,
  AlignCenter,
  AlignRight,
  Trash2,
} from "lucide-react";

const HANDLES = ["nw", "ne", "sw", "se"] as const;

export function ImageView({
  node,
  updateAttributes,
  deleteNode,
  selected,
}: NodeViewProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const captionRef = useRef<HTMLDivElement>(null);
  const [resizingWidth, setResizingWidth] = useState<string | null>(null);
  const resizingWidthRef = useRef<string | null>(null);

  // Keep ref in sync for use in event handlers
  useEffect(() => {
    resizingWidthRef.current = resizingWidth;
  }, [resizingWidth]);

  // Initialize caption text on mount
  useEffect(() => {
    if (captionRef.current && node.attrs.caption) {
      captionRef.current.textContent = node.attrs.caption;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCaptionBlur = useCallback(() => {
    const text = captionRef.current?.textContent || "";
    if (text !== node.attrs.caption) {
      updateAttributes({ caption: text });
    }
  }, [node.attrs.caption, updateAttributes]);

  const handleCaptionKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Prevent Enter from creating newlines in caption
      if (e.key === "Enter") {
        e.preventDefault();
        captionRef.current?.blur();
      }
    },
    []
  );

  const handleResizeStart = useCallback(
    (handle: (typeof HANDLES)[number], e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const figureEl = containerRef.current;
      if (!figureEl) return;

      const parentEl = figureEl.closest(".editor-content") || figureEl.parentElement;
      if (!parentEl) return;

      const containerWidth = parentEl.getBoundingClientRect().width;
      const startWidth = figureEl.getBoundingClientRect().width;
      const startX = e.clientX;
      const isLeft = handle === "nw" || handle === "sw";

      const onMouseMove = (moveEvent: MouseEvent) => {
        const dx = moveEvent.clientX - startX;
        const effectiveDx = isLeft ? -dx : dx;
        // Multiply by 2 because the image is centered, so moving one side effectively doubles the visual change
        const newWidthPx = Math.max(
          startWidth + effectiveDx * 2,
          containerWidth * 0.1
        );
        const newWidthPercent = Math.min(
          Math.round((newWidthPx / containerWidth) * 100),
          100
        );
        const widthStr = `${newWidthPercent}%`;
        setResizingWidth(widthStr);
        resizingWidthRef.current = widthStr;
      };

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";

        if (resizingWidthRef.current) {
          updateAttributes({ width: resizingWidthRef.current });
        }
        setResizingWidth(null);
        resizingWidthRef.current = null;
      };

      document.body.style.cursor = `${handle}-resize`;
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [updateAttributes]
  );

  const alignment = node.attrs.alignment || "center";
  const width = resizingWidth || node.attrs.width || "100%";

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
        <div className="image-floating-toolbar" contentEditable={false}>
          <button
            onClick={() => updateAttributes({ alignment: "left" })}
            className={alignment === "left" ? "active" : ""}
            title={t("editor.alignLeft")}
            type="button"
          >
            <AlignLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => updateAttributes({ alignment: "center" })}
            className={alignment === "center" ? "active" : ""}
            title={t("editor.alignCenter")}
            type="button"
          >
            <AlignCenter className="w-4 h-4" />
          </button>
          <button
            onClick={() => updateAttributes({ alignment: "right" })}
            className={alignment === "right" ? "active" : ""}
            title={t("editor.alignRight")}
            type="button"
          >
            <AlignRight className="w-4 h-4" />
          </button>
          <div className="toolbar-divider" />
          <button
            onClick={() => deleteNode()}
            title={t("common.delete")}
            type="button"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Image container with resize handles */}
      <div className="image-view-container" ref={containerRef}>
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
              onMouseDown={(e) => handleResizeStart(handle, e)}
            />
          ))}
      </div>

      {/* Editable caption */}
      <div
        ref={captionRef}
        className="image-caption"
        contentEditable
        suppressContentEditableWarning
        onBlur={handleCaptionBlur}
        onKeyDown={handleCaptionKeyDown}
        data-placeholder={t("editor.imageCaptionPlaceholder")}
      />
    </NodeViewWrapper>
  );
}
