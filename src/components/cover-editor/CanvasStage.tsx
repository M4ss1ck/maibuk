import { useEffect, useRef } from "react";
import { Canvas, type FabricObject, IText } from "fabric";
import { useCoverStore } from "../../features/covers/store";
import { applyBackground, buildObject } from "./render/toFabric";
import { readGeometry } from "./render/fromFabric";

interface CanvasStageProps {
  className?: string;
}

function layerIdOf(obj: FabricObject | undefined | null): string | undefined {
  return (obj as (FabricObject & { layerId?: string }) | undefined)?.layerId;
}

export function CanvasStage({ className = "" }: CanvasStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const elRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<Canvas | null>(null);
  // True while we programmatically rebuild the canvas, so object/selection
  // events fired during the rebuild don't write back into the store.
  const applyingRef = useRef(false);

  const scene = useCoverStore((s) => s.scene);
  const selectedId = useCoverStore((s) => s.selectedId);

  // Create the Fabric canvas once.
  useEffect(() => {
    if (!elRef.current) return;
    const canvas = new Canvas(elRef.current, {
      preserveObjectStacking: true,
      selection: true,
    });
    fabricRef.current = canvas;

    const { updateLayer, select } = useCoverStore.getState();

    canvas.on("object:modified", (e) => {
      if (applyingRef.current || !e.target) return;
      const read = readGeometry(e.target);
      if (read) updateLayer(read.id, read.patch);
    });

    canvas.on("selection:created", (e) => {
      if (applyingRef.current) return;
      select(layerIdOf(e.selected?.[0]) ?? null);
    });
    canvas.on("selection:updated", (e) => {
      if (applyingRef.current) return;
      select(layerIdOf(e.selected?.[0]) ?? null);
    });
    canvas.on("selection:cleared", () => {
      if (applyingRef.current) return;
      select(null);
    });

    canvas.on("mouse:dblclick", (e) => {
      if (e.target instanceof IText) {
        canvas.setActiveObject(e.target);
        e.target.enterEditing();
        e.target.selectAll();
        canvas.requestRenderAll();
      }
    });

    canvas.on("text:editing:exited", (e) => {
      const target = e.target;
      if (!(target instanceof IText)) return;
      const id = layerIdOf(target);
      if (id) updateLayer(id, { text: target.text ?? "" });
    });

    return () => {
      canvas.dispose();
      fabricRef.current = null;
    };
  }, []);

  // Resize/zoom-to-fit whenever the document size changes.
  useEffect(() => {
    const canvas = fabricRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const pad = 48;
    const availW = container.clientWidth - pad;
    const availH = container.clientHeight - pad;
    const scale = Math.min(availW / scene.doc.width, availH / scene.doc.height, 1);
    canvas.setZoom(scale);
    canvas.setDimensions({
      width: Math.round(scene.doc.width * scale),
      height: Math.round(scene.doc.height * scale),
    });
    canvas.requestRenderAll();
  }, [scene.doc.width, scene.doc.height]);

  // Rebuild all objects whenever the scene changes.
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    let cancelled = false;

    (async () => {
      applyingRef.current = true;
      canvas.remove(...canvas.getObjects());
      await applyBackground(canvas, scene.background);
      for (const layer of scene.layers) {
        if (cancelled) break;
        if (layer.hidden) continue;
        const obj = await buildObject(layer);
        if (obj && !cancelled) canvas.add(obj);
      }
      if (!cancelled) {
        // Restore active selection.
        if (selectedId) {
          const match = canvas.getObjects().find((o) => layerIdOf(o) === selectedId);
          if (match) canvas.setActiveObject(match);
        }
        canvas.requestRenderAll();
      }
      applyingRef.current = false;
    })();

    return () => {
      cancelled = true;
    };
  }, [scene]);

  // Sync active object when selection changes in the store.
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const current = layerIdOf(canvas.getActiveObject());
    if (current === selectedId) return;
    applyingRef.current = true;
    if (!selectedId) {
      canvas.discardActiveObject();
    } else {
      const match = canvas.getObjects().find((o) => layerIdOf(o) === selectedId);
      if (match) canvas.setActiveObject(match);
    }
    canvas.requestRenderAll();
    applyingRef.current = false;
  }, [selectedId]);

  return (
    <div
      ref={containerRef}
      className={`flex items-center justify-center bg-muted/30 overflow-hidden ${className}`}
    >
      <div className="shadow-2xl">
        <canvas ref={elRef} />
      </div>
    </div>
  );
}
