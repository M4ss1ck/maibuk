import {
  COVER_SCHEMA_VERSION,
  type CoverScene,
  type ImageLayer,
  type ShapeLayer,
  type TextLayer,
} from "./schema";

export const DEFAULT_FILTERS = { brightness: 0, contrast: 0, saturation: 0, blur: 0 };

export interface CoverPreset {
  id: string;
  name: string;
  width: number;
  height: number;
  dpi: number;
  description: string;
}

export const PRESETS: CoverPreset[] = [
  {
    id: "6x9",
    name: '6" x 9"',
    width: 1800,
    height: 2700,
    dpi: 300,
    description: "Standard paperback",
  },
  {
    id: "5x8",
    name: '5" x 8"',
    width: 1500,
    height: 2400,
    dpi: 300,
    description: "Mass market paperback",
  },
  {
    id: "5.5x8.5",
    name: '5.5" x 8.5"',
    width: 1650,
    height: 2550,
    dpi: 300,
    description: "Digest size",
  },
  {
    id: "8.5x11",
    name: '8.5" x 11"',
    width: 2550,
    height: 3300,
    dpi: 300,
    description: "Letter size",
  },
  { id: "a5", name: "A5", width: 1748, height: 2480, dpi: 300, description: "International A5" },
  {
    id: "kindle",
    name: "Kindle",
    width: 1600,
    height: 2560,
    dpi: 300,
    description: "Amazon Kindle",
  },
];

export const FONT_FAMILIES = [
  "Georgia",
  "Times New Roman",
  "Garamond",
  "Palatino",
  "Arial",
  "Helvetica",
  "Verdana",
  "Trebuchet MS",
  "Impact",
  "Courier New",
];

export const PRESET_COLORS = [
  "#000000",
  "#ffffff",
  "#1a1a2e",
  "#16213e",
  "#0f3460",
  "#e94560",
  "#533483",
  "#2c3e50",
  "#34495e",
  "#8e44ad",
  "#2980b9",
  "#27ae60",
  "#f39c12",
  "#d35400",
  "#c0392b",
  "#7f8c8d",
];

export const DEFAULT_BACKGROUND_COLOR = "#1a1a2e";

function genId(): string {
  return crypto.randomUUID();
}

export function getPreset(presetId: string): CoverPreset {
  return PRESETS.find((p) => p.id === presetId) ?? PRESETS[0];
}

export function createDefaultScene(presetId: string): CoverScene {
  const preset = getPreset(presetId);
  return {
    schemaVersion: COVER_SCHEMA_VERSION,
    doc: {
      width: preset.width,
      height: preset.height,
      dpi: preset.dpi,
      bleed: 0,
      safeMargin: Math.round(preset.width * 0.05),
      presetId: preset.id,
    },
    background: { type: "solid", color: DEFAULT_BACKGROUND_COLOR },
    layers: [],
  };
}

type TextRole = TextLayer["role"];

const ROLE_DEFAULTS: Record<
  TextRole,
  { size: number; weight: "normal" | "bold"; style: "normal" | "italic"; family: string }
> = {
  title: { size: 72, weight: "bold", style: "normal", family: "Georgia" },
  subtitle: { size: 32, weight: "normal", style: "italic", family: "Georgia" },
  author: { size: 36, weight: "normal", style: "normal", family: "Arial" },
  custom: { size: 40, weight: "normal", style: "normal", family: "Georgia" },
};

export function createTextLayer(args: {
  role: TextRole;
  text: string;
  docWidth: number;
  docHeight: number;
}): TextLayer {
  const { role, text, docWidth, docHeight } = args;
  const d = ROLE_DEFAULTS[role];
  const lineHeight = role === "subtitle" ? 1.4 : 1.2;
  const width = Math.round(docWidth * 0.8);
  const height = Math.round(d.size * lineHeight);
  return {
    id: genId(),
    name: role,
    type: "text",
    role,
    text,
    x: Math.round(docWidth * 0.1),
    y: Math.round(docHeight / 2 - height / 2),
    width,
    height,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    font: {
      family: d.family,
      size: d.size,
      weight: d.weight,
      style: d.style,
      letterSpacing: 0,
      lineHeight,
    },
    align: "center",
    fill: { type: "solid", color: "#ffffff" },
  };
}

export function createShapeLayer(args: {
  shape: ShapeLayer["shape"];
  docWidth: number;
  docHeight: number;
}): ShapeLayer {
  const { shape, docWidth, docHeight } = args;
  const width = Math.round(docWidth * 0.4);
  const height = shape === "line" ? 0 : Math.round(docHeight * 0.15);
  return {
    id: genId(),
    name: shape,
    type: "shape",
    shape,
    x: Math.round(docWidth / 2 - width / 2),
    y: Math.round(docHeight / 2 - height / 2),
    width,
    height: shape === "line" ? 4 : height,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    fill: { type: "solid", color: "#e94560" },
    ...(shape === "line" ? { stroke: { color: "#e94560", width: 4 } } : {}),
    ...(shape === "rect" ? { radius: 0 } : {}),
  };
}

export function createImageLayer(args: {
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  docWidth: number;
  docHeight: number;
}): ImageLayer {
  const { src, naturalWidth, naturalHeight, docWidth, docHeight } = args;
  const maxW = docWidth * 0.8;
  const maxH = docHeight * 0.8;
  const scale = Math.min(maxW / naturalWidth, maxH / naturalHeight, 1) || 1;
  const width = Math.round(naturalWidth * scale);
  const height = Math.round(naturalHeight * scale);
  return {
    id: genId(),
    name: "Image",
    type: "image",
    src,
    x: Math.round(docWidth / 2 - width / 2),
    y: Math.round(docHeight / 2 - height / 2),
    width,
    height,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
  };
}
