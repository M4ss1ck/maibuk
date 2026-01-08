import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import { Canvas, IText, FabricImage } from "fabric";
import type { CoverDimension, TextStyle } from "../../features/covers/types";

export interface CoverCanvasRef {
  addText: (text: string, style: TextStyle, type?: string) => void;
  addImage: (url: string) => Promise<void>;
  setBackgroundColor: (color: string) => void;
  setBackgroundImage: (url: string) => Promise<void>;
  exportToPNG: () => string;
  exportToJPEG: (quality?: number) => string;
  getJSON: () => string;
  loadJSON: (json: string) => Promise<void>;
  deleteSelected: () => void;
  bringForward: () => void;
  sendBackward: () => void;
  clearCanvas: () => void;
}

interface CoverCanvasProps {
  dimension: CoverDimension;
  onSelectionChange?: (hasSelection: boolean, selectedType?: string) => void;
  onModified?: () => void;
  onCanvasReady?: () => void;
  className?: string;
}

export const CoverCanvas = forwardRef<CoverCanvasRef, CoverCanvasProps>(
  ({ dimension, onSelectionChange, onModified, onCanvasReady, className = "" }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const fabricRef = useRef<Canvas | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    // Store callbacks in refs to avoid recreating canvas when they change
    const onSelectionChangeRef = useRef(onSelectionChange);
    const onModifiedRef = useRef(onModified);
    const onCanvasReadyRef = useRef(onCanvasReady);

    // Update refs when callbacks change
    onSelectionChangeRef.current = onSelectionChange;
    onModifiedRef.current = onModified;
    onCanvasReadyRef.current = onCanvasReady;

    // Calculate scale to fit canvas in container
    const getScale = useCallback(() => {
      if (!containerRef.current) return 0.3;
      const containerWidth = containerRef.current.clientWidth - 48;
      const containerHeight = containerRef.current.clientHeight - 48;
      const scaleX = containerWidth / dimension.width;
      const scaleY = containerHeight / dimension.height;
      return Math.min(scaleX, scaleY, 0.5);
    }, [dimension]);

    // Initialize canvas
    useEffect(() => {
      if (!canvasRef.current) return;

      const scale = getScale();
      const canvas = new Canvas(canvasRef.current, {
        width: dimension.width * scale,
        height: dimension.height * scale,
        backgroundColor: "#1a1a2e",
        selection: true,
        preserveObjectStacking: true,
      });

      // Set zoom to handle the actual dimensions
      canvas.setZoom(scale);
      canvas.setDimensions({
        width: dimension.width * scale,
        height: dimension.height * scale,
      });

      // Event handlers - use refs to avoid recreating canvas when callbacks change
      canvas.on("selection:created", (e) => {
        const obj = e.selected?.[0];
        onSelectionChangeRef.current?.(true, (obj as any)?.textType);
      });

      canvas.on("selection:updated", (e) => {
        const obj = e.selected?.[0];
        onSelectionChangeRef.current?.(true, (obj as any)?.textType);
      });

      canvas.on("selection:cleared", () => {
        onSelectionChangeRef.current?.(false);
      });

      canvas.on("object:modified", () => {
        onModifiedRef.current?.();
      });

      // Enable text editing on double-click
      canvas.on("mouse:dblclick", (e) => {
        const target = e.target;
        if (target && target instanceof IText) {
          // Enter editing mode
          canvas.setActiveObject(target);
          target.enterEditing();
          target.selectAll();
          canvas.requestRenderAll();
        }
      });

      fabricRef.current = canvas;

      // Notify parent that canvas is ready
      onCanvasReadyRef.current?.();

      return () => {
        canvas.dispose();
        fabricRef.current = null;
      };
    }, [dimension, getScale]);

    // Expose methods via ref
    useImperativeHandle(ref, () => ({
      addText: (text: string, style: TextStyle, type?: string) => {
        const canvas = fabricRef.current;
        if (!canvas) return;

        const textObj = new IText(text, {
          left: dimension.width / 2,
          top: dimension.height / 2,
          originX: "center",
          originY: "center",
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          fontStyle: style.fontStyle,
          fill: style.fill,
          textAlign: style.textAlign,
          lineHeight: style.lineHeight,
        });

        // Store type for identification
        (textObj as any).textType = type;

        if (style.shadow) {
          textObj.set("shadow", {
            color: style.shadow.color,
            blur: style.shadow.blur,
            offsetX: style.shadow.offsetX,
            offsetY: style.shadow.offsetY,
          });
        }

        canvas.add(textObj);
        canvas.setActiveObject(textObj);
        canvas.requestRenderAll();
        onModifiedRef.current?.();
      },

      addImage: async (url: string) => {
        const canvas = fabricRef.current;
        if (!canvas) return;

        const img = await FabricImage.fromURL(url, { crossOrigin: "anonymous" });

        // Scale image to fit canvas width while maintaining aspect ratio
        const maxWidth = dimension.width * 0.8;
        const maxHeight = dimension.height * 0.8;
        const scale = Math.min(maxWidth / img.width!, maxHeight / img.height!, 1);

        img.set({
          left: dimension.width / 2,
          top: dimension.height / 2,
          originX: "center",
          originY: "center",
          scaleX: scale,
          scaleY: scale,
        });

        canvas.add(img);
        canvas.setActiveObject(img);
        canvas.requestRenderAll();
        onModifiedRef.current?.();
      },

      setBackgroundColor: (color: string) => {
        const canvas = fabricRef.current;
        if (!canvas) return;
        canvas.backgroundColor = color;
        canvas.requestRenderAll();
        onModifiedRef.current?.();
      },

      setBackgroundImage: async (url: string) => {
        const canvas = fabricRef.current;
        if (!canvas) return;

        const img = await FabricImage.fromURL(url, { crossOrigin: "anonymous" });

        // Scale to cover entire canvas
        const scaleX = dimension.width / img.width!;
        const scaleY = dimension.height / img.height!;
        const scale = Math.max(scaleX, scaleY);

        img.set({
          scaleX: scale,
          scaleY: scale,
          originX: "left",
          originY: "top",
          selectable: false,
          evented: false,
        });

        // Insert at bottom
        canvas.insertAt(0, img);
        canvas.requestRenderAll();
        onModifiedRef.current?.();
      },

      exportToPNG: () => {
        const canvas = fabricRef.current;
        if (!canvas) return "";

        // Export at full resolution
        const currentZoom = canvas.getZoom();
        canvas.setZoom(1);
        canvas.setDimensions({
          width: dimension.width,
          height: dimension.height,
        });

        const dataUrl = canvas.toDataURL({
          format: "png",
          multiplier: 1,
        });

        // Restore zoom
        canvas.setZoom(currentZoom);
        canvas.setDimensions({
          width: dimension.width * currentZoom,
          height: dimension.height * currentZoom,
        });

        return dataUrl;
      },

      exportToJPEG: (quality = 0.9) => {
        const canvas = fabricRef.current;
        if (!canvas) return "";

        const currentZoom = canvas.getZoom();
        canvas.setZoom(1);
        canvas.setDimensions({
          width: dimension.width,
          height: dimension.height,
        });

        const dataUrl = canvas.toDataURL({
          format: "jpeg",
          quality,
          multiplier: 1,
        });

        canvas.setZoom(currentZoom);
        canvas.setDimensions({
          width: dimension.width * currentZoom,
          height: dimension.height * currentZoom,
        });

        return dataUrl;
      },

      getJSON: () => {
        const canvas = fabricRef.current;
        if (!canvas) return "{}";
        return JSON.stringify(canvas.toJSON());
      },

      loadJSON: async (json: string) => {
        const canvas = fabricRef.current;
        if (!canvas) return;

        await canvas.loadFromJSON(JSON.parse(json));
        canvas.requestRenderAll();
      },

      deleteSelected: () => {
        const canvas = fabricRef.current;
        if (!canvas) return;

        const active = canvas.getActiveObjects();
        if (active.length > 0) {
          active.forEach((obj) => canvas.remove(obj));
          canvas.discardActiveObject();
          canvas.requestRenderAll();
          onModifiedRef.current?.();
        }
      },

      bringForward: () => {
        const canvas = fabricRef.current;
        if (!canvas) return;

        const active = canvas.getActiveObject();
        if (active) {
          canvas.bringObjectForward(active);
          canvas.requestRenderAll();
          onModifiedRef.current?.();
        }
      },

      sendBackward: () => {
        const canvas = fabricRef.current;
        if (!canvas) return;

        const active = canvas.getActiveObject();
        if (active) {
          canvas.sendObjectBackwards(active);
          canvas.requestRenderAll();
          onModifiedRef.current?.();
        }
      },

      clearCanvas: () => {
        const canvas = fabricRef.current;
        if (!canvas) return;

        canvas.clear();
        canvas.backgroundColor = "#1a1a2e";
        canvas.requestRenderAll();
        onModifiedRef.current?.();
      },
    }));

    return (
      <div
        ref={containerRef}
        className={`flex items-center justify-center bg-muted/30 ${className}`}
      >
        <div className="shadow-2xl">
          <canvas ref={canvasRef} />
        </div>
      </div>
    );
  }
);

CoverCanvas.displayName = "CoverCanvas";
