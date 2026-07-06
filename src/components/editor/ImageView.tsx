import { useRef, useState, useCallback, useEffect } from "react";
import { NodeViewWrapper, NodeViewContent } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import { AlignLeft, AlignCenter, AlignRight, Trash2 } from "lucide-react";
import { NodeSelection } from "@tiptap/pm/state";
import { Tooltip } from "@/components/ui";

const HANDLES = ["nw", "ne", "sw", "se"] as const;

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

  // Keep ref in sync for use in event handlers
  useEffect(() => {
    resizingWidthRef.current = resizingWidth;
  }, [resizingWidth]);

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
        const newWidthPx = Math.max(startWidth + effectiveDx * 2, containerWidth * 0.1);
        const newWidthPercent = Math.min(Math.round((newWidthPx / containerWidth) * 100), 100);
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

  const handleImageMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
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
        <div className="image-floating-toolbar" contentEditable={false}>
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
          <Tooltip content={t("common.delete")}>
            <button onClick={() => deleteNode()} aria-label={t("common.delete")} type="button">
              <Trash2 className="w-4 h-4" />
            </button>
          </Tooltip>
        </div>
      )}

      {/* Image container with resize handles */}
      <div className="image-view-container" ref={containerRef} onMouseDown={handleImageMouseDown}>
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
