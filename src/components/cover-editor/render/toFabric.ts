import {
  type Canvas,
  Ellipse,
  FabricImage,
  type FabricObject,
  IText,
  Line,
  Rect,
  Shadow,
} from "fabric";
import type { Background, Layer, Paint } from "../../../features/covers/scene/schema";

function solidColor(paint: Paint, fallback = "#000000"): string {
  return paint.type === "solid" ? paint.color : fallback;
}

/** Apply the scene background to a Fabric canvas. Phase 1: solid + image. */
export async function applyBackground(canvas: Canvas, bg: Background): Promise<void> {
  canvas.backgroundImage = undefined;
  if (bg.type === "solid") {
    canvas.backgroundColor = bg.color;
    return;
  }
  if (bg.type === "image" && bg.src) {
    canvas.backgroundColor = "#000000";
    const img = await FabricImage.fromURL(bg.src, { crossOrigin: "anonymous" });
    const w = img.width ?? 1;
    const h = img.height ?? 1;
    const cw = canvas.getWidth();
    const ch = canvas.getHeight();
    let scaleX = cw / w;
    let scaleY = ch / h;
    if (bg.fit === "cover") {
      const s = Math.max(scaleX, scaleY);
      scaleX = s;
      scaleY = s;
    } else if (bg.fit === "contain") {
      const s = Math.min(scaleX, scaleY);
      scaleX = s;
      scaleY = s;
    }
    img.set({ originX: "left", originY: "top", left: 0, top: 0, scaleX, scaleY, opacity: bg.opacity });
    canvas.backgroundImage = img;
    return;
  }
  // gradients (Phase 2): fall back to a neutral fill for now.
  canvas.backgroundColor = "#1a1a2e";
}

function applyCommon(obj: FabricObject, layer: Layer): void {
  obj.set({
    left: layer.x,
    top: layer.y,
    originX: "left",
    originY: "top",
    angle: layer.rotation,
    opacity: layer.opacity,
    visible: !layer.hidden,
    selectable: !layer.locked,
    evented: !layer.locked,
    lockMovementX: layer.locked,
    lockMovementY: layer.locked,
  });
  (obj as FabricObject & { layerId?: string }).layerId = layer.id;
}

/** Build a Fabric object for a scene layer. Returns null for unsupported layers. */
export async function buildObject(layer: Layer): Promise<FabricObject | null> {
  if (layer.type === "text") {
    const obj = new IText(layer.text, {
      fontFamily: layer.font.family,
      fontSize: layer.font.size,
      fontWeight: layer.font.weight,
      fontStyle: layer.font.style,
      lineHeight: layer.font.lineHeight,
      charSpacing: layer.font.size > 0 ? (layer.font.letterSpacing / layer.font.size) * 1000 : 0,
      textAlign: layer.align,
      fill: solidColor(layer.fill, "#ffffff"),
      width: layer.width,
    });
    if (layer.stroke && layer.stroke.width > 0) {
      obj.set({ stroke: layer.stroke.color, strokeWidth: layer.stroke.width });
    }
    if (layer.shadow) {
      obj.set(
        "shadow",
        new Shadow({
          color: layer.shadow.color,
          blur: layer.shadow.blur,
          offsetX: layer.shadow.offsetX,
          offsetY: layer.shadow.offsetY,
        })
      );
    }
    applyCommon(obj, layer);
    return obj;
  }

  if (layer.type === "image") {
    if (!layer.src) return null;
    const img = await FabricImage.fromURL(layer.src, { crossOrigin: "anonymous" });
    const natural = img.width ?? layer.width;
    img.scaleToWidth(layer.width);
    void natural;
    applyCommon(img, layer);
    return img;
  }

  if (layer.type === "shape") {
    const fill = solidColor(layer.fill, "#888888");
    const stroke = layer.stroke;
    let obj: FabricObject;
    if (layer.shape === "rect") {
      obj = new Rect({ width: layer.width, height: layer.height, fill, rx: layer.radius, ry: layer.radius });
    } else if (layer.shape === "ellipse") {
      obj = new Ellipse({ rx: layer.width / 2, ry: layer.height / 2, fill });
    } else {
      obj = new Line([0, 0, layer.width, 0], { stroke: stroke?.color ?? fill, strokeWidth: stroke?.width ?? 2 });
    }
    if (stroke && stroke.width > 0 && layer.shape !== "line") {
      obj.set({ stroke: stroke.color, strokeWidth: stroke.width });
    }
    applyCommon(obj, layer);
    return obj;
  }

  return null;
}
