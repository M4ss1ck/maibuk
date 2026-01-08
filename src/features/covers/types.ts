export interface CoverDimension {
  id: string;
  name: string;
  width: number;
  height: number;
  description: string;
}

export const COVER_DIMENSIONS: CoverDimension[] = [
  { id: "6x9", name: '6" x 9"', width: 1800, height: 2700, description: "Standard paperback" },
  { id: "5x8", name: '5" x 8"', width: 1500, height: 2400, description: "Mass market paperback" },
  { id: "5.5x8.5", name: '5.5" x 8.5"', width: 1650, height: 2550, description: "Digest size" },
  { id: "8.5x11", name: '8.5" x 11"', width: 2550, height: 3300, description: "Letter size" },
  { id: "a5", name: "A5", width: 1748, height: 2480, description: "International A5" },
  { id: "kindle", name: "Kindle", width: 1600, height: 2560, description: "Amazon Kindle" },
];

export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: "normal" | "bold";
  fontStyle: "normal" | "italic";
  fill: string;
  textAlign: "left" | "center" | "right";
  lineHeight: number;
  shadow?: {
    color: string;
    blur: number;
    offsetX: number;
    offsetY: number;
  };
}

export interface CoverTextElement {
  id: string;
  type: "title" | "subtitle" | "author" | "custom";
  text: string;
  style: TextStyle;
  position: { x: number; y: number };
}

export interface CoverTemplate {
  id: string;
  name: string;
  category: string;
  dimensionId: string;
  backgroundColor: string;
  backgroundImage?: string;
  textElements: CoverTextElement[];
  thumbnailUrl?: string;
}

export const DEFAULT_TEXT_STYLES: Record<string, TextStyle> = {
  title: {
    fontFamily: "Georgia",
    fontSize: 72,
    fontWeight: "bold",
    fontStyle: "normal",
    fill: "#ffffff",
    textAlign: "center",
    lineHeight: 1.2,
  },
  subtitle: {
    fontFamily: "Georgia",
    fontSize: 32,
    fontWeight: "normal",
    fontStyle: "italic",
    fill: "#ffffff",
    textAlign: "center",
    lineHeight: 1.4,
  },
  author: {
    fontFamily: "Arial",
    fontSize: 36,
    fontWeight: "normal",
    fontStyle: "normal",
    fill: "#ffffff",
    textAlign: "center",
    lineHeight: 1.2,
  },
};

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
