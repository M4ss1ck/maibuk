import { COVER_SCHEMA_VERSION, type CoverScene, type Layer, type TextLayer } from "./schema";
import { createTextLayer, getPreset } from "./defaults";

export interface TemplateArgs {
  title: string;
  author: string;
  presetId: string;
}

export interface CoverTemplate {
  id: string;
  name: string;
  build: (
    args: TemplateArgs,
    dim: { width: number; height: number }
  ) => Pick<CoverScene, "background" | "layers">;
}

function genId(): string {
  return crypto.randomUUID();
}

function title(args: TemplateArgs, w: number, h: number): TextLayer {
  return createTextLayer({ role: "title", text: args.title, docWidth: w, docHeight: h });
}
function author(args: TemplateArgs, w: number, h: number): TextLayer {
  return createTextLayer({ role: "author", text: args.author, docWidth: w, docHeight: h });
}

export const TEMPLATES: CoverTemplate[] = [
  {
    id: "classic-centered",
    name: "Classic Centered",
    build: (args, { width, height }) => {
      const t = title(args, width, height);
      t.y = Math.round(height * 0.28);
      const a = author(args, width, height);
      a.y = Math.round(height * 0.82);
      return { background: { type: "solid", color: "#1a1a2e" }, layers: [t, a] };
    },
  },
  {
    id: "bold-gradient",
    name: "Bold Gradient",
    build: (args, { width, height }) => {
      const t = title(args, width, height);
      t.y = Math.round(height * 0.12);
      t.font.size = Math.round(width * 0.11);
      t.fill = { type: "solid", color: "#ffffff" };
      const a = author(args, width, height);
      a.y = Math.round(height * 0.85);
      return {
        background: {
          type: "linear-gradient",
          angle: 90,
          stops: [
            { offset: 0, color: "#0f3460" },
            { offset: 1, color: "#e94560" },
          ],
        },
        layers: [t, a],
      };
    },
  },
  {
    id: "minimal-line",
    name: "Minimal Line",
    build: (args, { width, height }) => {
      const t = title(args, width, height);
      t.y = Math.round(height * 0.4);
      t.fill = { type: "solid", color: "#1c1917" };
      const a = author(args, width, height);
      a.y = Math.round(height * 0.6);
      a.fill = { type: "solid", color: "#57534e" };
      const line: Layer = {
        id: genId(),
        name: "line",
        type: "shape",
        shape: "line",
        x: Math.round(width * 0.3),
        y: Math.round(height * 0.52),
        width: Math.round(width * 0.4),
        height: 4,
        rotation: 0,
        opacity: 1,
        locked: false,
        hidden: false,
        fill: { type: "solid", color: "#1c1917" },
        stroke: { color: "#1c1917", width: 4 },
      };
      return { background: { type: "solid", color: "#fafaf9" }, layers: [t, line, a] };
    },
  },
];

/** Build a complete v1 scene for a template id, sized to the given preset. */
export function buildTemplateScene(templateId: string, args: TemplateArgs): CoverScene {
  const tpl = TEMPLATES.find((x) => x.id === templateId) ?? TEMPLATES[0];
  const preset = getPreset(args.presetId);
  const { background, layers } = tpl.build(args, { width: preset.width, height: preset.height });
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
    background,
    layers,
  };
}
