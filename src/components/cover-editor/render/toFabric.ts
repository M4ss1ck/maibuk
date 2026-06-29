import {
  type Canvas,
  Ellipse,
  FabricImage,
  type FabricObject,
  filters,
  Gradient,
  IText,
  Line,
  Path,
  Rect,
  Shadow,
  Textbox,
  type TFiller,
} from "fabric";
import type { ImageLayer } from "../../../features/covers/scene/schema";
import type { Background, Layer, Paint } from "../../../features/covers/scene/schema";
import { linearGradientCoords, sortStops } from "../../../features/covers/scene/paint";

/**
 * Convert a scene Paint into a Fabric fill: a color string for solid paints, or
 * a percentage-space Gradient for gradients (zoom-independent, relative to the
 * filled object's bounding box).
 */
function paintToFill(paint: Paint): string | TFiller {
  if (paint.type === "solid") return paint.color;
  const colorStops = sortStops(paint.stops).map((s) => ({ offset: s.offset, color: s.color }));
  if (paint.type === "linear-gradient") {
    const c = linearGradientCoords(paint.angle, 1, 1);
    return new Gradient({ type: "linear", gradientUnits: "percentage", coords: c, colorStops });
  }
  return new Gradient({
    type: "radial",
    gradientUnits: "percentage",
    coords: { x1: paint.cx, y1: paint.cy, r1: 0, x2: paint.cx, y2: paint.cy, r2: paint.r },
    colorStops,
  });
}

/**
 * Build a pixel-space gradient sized to `w`×`h` for use as a canvas background.
 * (Percentage units need an owning object's box, which a canvas background lacks,
 * so it would otherwise collapse to a single color.)
 */
function gradientToCanvasFill(bg: Background, w: number, h: number): string | TFiller {
  if (bg.type === "linear-gradient") {
    const colorStops = sortStops(bg.stops).map((s) => ({ offset: s.offset, color: s.color }));
    const c = linearGradientCoords(bg.angle, w, h);
    return new Gradient({ type: "linear", gradientUnits: "pixels", coords: c, colorStops });
  }
  if (bg.type === "radial-gradient") {
    const colorStops = sortStops(bg.stops).map((s) => ({ offset: s.offset, color: s.color }));
    return new Gradient({
      type: "radial",
      gradientUnits: "pixels",
      coords: {
        x1: bg.cx * w,
        y1: bg.cy * h,
        r1: 0,
        x2: bg.cx * w,
        y2: bg.cy * h,
        r2: bg.r * Math.max(w, h),
      },
      colorStops,
    });
  }
  return "#1a1a2e";
}

/** Apply the scene background to a Fabric canvas. Supports solid, image, gradients. */
export async function applyBackground(canvas: Canvas, bg: Background): Promise<void> {
  canvas.backgroundImage = undefined;
  // Backgrounds are drawn in doc space (backgroundVpt), so size to doc, not the
  // zoomed element.
  const zoom = canvas.getZoom() || 1;
  const docW = canvas.getWidth() / zoom;
  const docH = canvas.getHeight() / zoom;

  if (bg.type === "solid") {
    canvas.backgroundColor = bg.color;
    return;
  }
  if (bg.type === "image" && bg.src) {
    canvas.backgroundColor = "#000000";
    const img = await FabricImage.fromURL(bg.src, { crossOrigin: "anonymous" });
    const w = img.width ?? 1;
    const h = img.height ?? 1;
    let scaleX = docW / w;
    let scaleY = docH / h;
    if (bg.fit === "cover") {
      const s = Math.max(scaleX, scaleY);
      scaleX = s;
      scaleY = s;
    } else if (bg.fit === "contain") {
      const s = Math.min(scaleX, scaleY);
      scaleX = s;
      scaleY = s;
    }
    img.set({
      originX: "left",
      originY: "top",
      left: 0,
      top: 0,
      scaleX,
      scaleY,
      opacity: bg.opacity,
    });
    canvas.backgroundImage = img;
    return;
  }
  // Gradient backgrounds: fill with a pixel-space gradient sized to the doc.
  if (bg.type === "linear-gradient" || bg.type === "radial-gradient") {
    canvas.backgroundColor = gradientToCanvasFill(bg, docW, docH);
    return;
  }
  canvas.backgroundColor = "#1a1a2e";
}

function applyImageCrop(img: FabricImage, layer: ImageLayer): void {
  if (!layer.crop) return;
  img.set({
    cropX: layer.crop.x,
    cropY: layer.crop.y,
    width: layer.crop.width,
    height: layer.crop.height,
  });
}

function applyImageFilters(img: FabricImage, layer: ImageLayer): void {
  const f = layer.filters;
  if (!f) return;
  const list = [];
  if (f.brightness) list.push(new filters.Brightness({ brightness: f.brightness }));
  if (f.contrast) list.push(new filters.Contrast({ contrast: f.contrast }));
  if (f.saturation) list.push(new filters.Saturation({ saturation: f.saturation }));
  if (f.blur) list.push(new filters.Blur({ blur: f.blur }));
  img.filters = list;
  img.applyFilters();
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
    const curved = !!(layer.curve && layer.curve.spread > 0);
    const opts = {
      fontFamily: layer.font.family,
      fontSize: layer.font.size,
      fontWeight: layer.font.weight,
      fontStyle: layer.font.style,
      lineHeight: layer.font.lineHeight,
      charSpacing: layer.font.size > 0 ? (layer.font.letterSpacing / layer.font.size) * 1000 : 0,
      textAlign: layer.align,
      fill: paintToFill(layer.fill),
      width: layer.width,
    };
    // Textbox honors `width` (so alignment/centering work); curved text needs a
    // path, which only the plain IText supports.
    const obj = curved ? new IText(layer.text, opts) : new Textbox(layer.text, opts);
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
    if (layer.curve && layer.curve.spread > 0) {
      // Render the text along a symmetric circular arc whose arc length ~ width.
      const t = (layer.curve.spread * Math.PI) / 180;
      const r = layer.width / t;
      const chord = 2 * r * Math.sin(t / 2);
      const path = new Path(`M 0 0 A ${r} ${r} 0 0 1 ${chord} 0`, { fill: "", stroke: "" });
      obj.set({ path, pathAlign: "center" });
    }
    applyCommon(obj, layer);
    return obj;
  }

  if (layer.type === "image") {
    if (!layer.src) return null;
    const img = await FabricImage.fromURL(layer.src, { crossOrigin: "anonymous" });
    applyImageCrop(img, layer);
    applyImageFilters(img, layer);
    img.scaleToWidth(layer.width);
    applyCommon(img, layer);
    return img;
  }

  if (layer.type === "shape") {
    const fill = paintToFill(layer.fill);
    const stroke = layer.stroke;
    let obj: FabricObject;
    if (layer.shape === "rect") {
      obj = new Rect({
        width: layer.width,
        height: layer.height,
        fill,
        rx: layer.radius,
        ry: layer.radius,
      });
    } else if (layer.shape === "ellipse") {
      obj = new Ellipse({ rx: layer.width / 2, ry: layer.height / 2, fill });
    } else {
      const lineColor =
        stroke?.color ?? (layer.fill.type === "solid" ? layer.fill.color : "#888888");
      obj = new Line([0, 0, layer.width, 0], {
        stroke: lineColor,
        strokeWidth: stroke?.width ?? 2,
      });
    }
    if (stroke && stroke.width > 0 && layer.shape !== "line") {
      obj.set({ stroke: stroke.color, strokeWidth: stroke.width });
    }
    applyCommon(obj, layer);
    return obj;
  }

  return null;
}
