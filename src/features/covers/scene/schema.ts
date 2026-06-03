// Versioned cover scene schema. This JSON is the source of truth for a cover,
// persisted to `books.cover_data`. Fabric is only the interactive renderer.

export const COVER_SCHEMA_VERSION = 1;

export interface CoverScene {
  schemaVersion: number; // = COVER_SCHEMA_VERSION
  doc: CoverDoc;
  background: Background;
  layers: Layer[]; // bottom-to-top paint order
}

export interface CoverDoc {
  width: number; // px at `dpi`
  height: number;
  dpi: number; // design DPI (default 300)
  bleed: number; // px, default 0
  safeMargin: number; // px
  presetId?: string; // e.g. "6x9", "kindle"
}

export type GradientStop = { offset: number; color: string }; // offset 0..1

export type Paint =
  | { type: "solid"; color: string }
  | { type: "linear-gradient"; angle: number; stops: GradientStop[] }
  | { type: "radial-gradient"; cx: number; cy: number; r: number; stops: GradientStop[] };

export type Background =
  | { type: "solid"; color: string }
  | { type: "linear-gradient"; angle: number; stops: GradientStop[] }
  | { type: "radial-gradient"; cx: number; cy: number; r: number; stops: GradientStop[] }
  | { type: "image"; src: string; fit: "cover" | "contain" | "stretch"; opacity: number };

export interface LayerBase {
  id: string;
  name: string;
  // bounding box in doc px, top-left origin
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number; // degrees
  opacity: number; // 0..1
  locked: boolean;
  hidden: boolean;
}

export interface TextLayer extends LayerBase {
  type: "text";
  role: "title" | "subtitle" | "author" | "custom";
  text: string;
  font: {
    family: string;
    size: number;
    weight: "normal" | "bold";
    style: "normal" | "italic";
    letterSpacing: number;
    lineHeight: number;
  };
  align: "left" | "center" | "right";
  fill: Paint;
  stroke?: { color: string; width: number };
  shadow?: { color: string; blur: number; offsetX: number; offsetY: number };
  curve?: { type: "arc"; spread: number }; // Phase 5
}

export interface ImageLayer extends LayerBase {
  type: "image";
  src: string; // base64 data URL
  crop?: { x: number; y: number; width: number; height: number }; // source px, Phase 3
  filters?: { brightness: number; contrast: number; saturation: number; blur: number }; // Phase 3
}

export interface ShapeLayer extends LayerBase {
  type: "shape";
  shape: "rect" | "ellipse" | "line";
  fill: Paint;
  stroke?: { color: string; width: number };
  radius?: number; // rect corner radius
}

export type Layer = TextLayer | ImageLayer | ShapeLayer;

export const isTextLayer = (l: Layer): l is TextLayer => l.type === "text";
export const isImageLayer = (l: Layer): l is ImageLayer => l.type === "image";
export const isShapeLayer = (l: Layer): l is ShapeLayer => l.type === "shape";
