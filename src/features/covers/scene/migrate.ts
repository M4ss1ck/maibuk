import { COVER_SCHEMA_VERSION, type Background, type CoverDoc, type CoverScene, type Layer } from "./schema";
import { DEFAULT_BACKGROUND_COLOR } from "./defaults";

function genId(): string {
  return crypto.randomUUID();
}

function freshScene(doc: CoverDoc): CoverScene {
  return {
    schemaVersion: COVER_SCHEMA_VERSION,
    doc,
    background: { type: "solid", color: DEFAULT_BACKGROUND_COLOR },
    layers: [],
  };
}

/**
 * Forward-migrate an already-versioned scene. Currently a no-op identity at v1;
 * future vN -> vN+1 steps compose here, ordered by source version.
 */
function migrateForward(scene: CoverScene): CoverScene {
  // No migrations beyond v1 yet.
  return { ...scene, schemaVersion: COVER_SCHEMA_VERSION };
}

type LegacyObject = Record<string, unknown> & {
  type?: string;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  scaleX?: number;
  scaleY?: number;
  angle?: number;
  originX?: string;
  originY?: string;
  opacity?: number;
};

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function toLayer(o: LegacyObject): Layer | null {
  const sw = num(o.width) * num(o.scaleX, 1);
  const sh = num(o.height) * num(o.scaleY, 1);
  const x = o.originX === "center" ? num(o.left) - sw / 2 : num(o.left);
  const y = o.originY === "center" ? num(o.top) - sh / 2 : num(o.top);
  const base = {
    id: genId(),
    x,
    y,
    width: sw,
    height: sh,
    rotation: num(o.angle),
    opacity: num(o.opacity, 1),
    locked: false,
    hidden: false,
  };

  const type = (o.type ?? "").toLowerCase();

  if (type === "itext" || type === "text" || type === "i-text" || type === "textbox") {
    const rawRole = typeof o.textType === "string" ? o.textType : "";
    const validRole: "title" | "subtitle" | "author" | "custom" =
      rawRole === "title" || rawRole === "subtitle" || rawRole === "author" ? rawRole : "custom";
    const shadow = o.shadow as
      | { color?: string; blur?: number; offsetX?: number; offsetY?: number }
      | undefined;
    return {
      ...base,
      type: "text",
      name: validRole,
      role: validRole,
      text: typeof o.text === "string" ? o.text : "",
      font: {
        family: typeof o.fontFamily === "string" ? o.fontFamily : "Georgia",
        size: num(o.fontSize, 40),
        weight: o.fontWeight === "bold" ? "bold" : "normal",
        style: o.fontStyle === "italic" ? "italic" : "normal",
        letterSpacing: num(o.charSpacing) ? num(o.charSpacing) / 1000 * num(o.fontSize, 40) : 0,
        lineHeight: num(o.lineHeight, 1.2),
      },
      align:
        o.textAlign === "left" || o.textAlign === "right" ? o.textAlign : "center",
      fill: { type: "solid", color: typeof o.fill === "string" ? o.fill : "#ffffff" },
      ...(shadow
        ? {
            shadow: {
              color: shadow.color ?? "#000000",
              blur: num(shadow.blur),
              offsetX: num(shadow.offsetX),
              offsetY: num(shadow.offsetY),
            },
          }
        : {}),
    };
  }

  if (type === "image") {
    return {
      ...base,
      type: "image",
      name: "Image",
      src: typeof o.src === "string" ? o.src : "",
    };
  }

  return null;
}

function migrateLegacy(parsed: Record<string, unknown>, doc: CoverDoc): CoverScene {
  const bgColor = typeof parsed.background === "string" ? parsed.background : DEFAULT_BACKGROUND_COLOR;
  const background: Background = { type: "solid", color: bgColor };
  const objects = Array.isArray(parsed.objects) ? (parsed.objects as LegacyObject[]) : [];
  const layers = objects.map(toLayer).filter((l): l is Layer => l !== null);
  return {
    schemaVersion: COVER_SCHEMA_VERSION,
    doc,
    background,
    layers,
  };
}

/**
 * Load a cover scene from persisted JSON, migrating legacy formats as needed.
 * - empty / unparseable -> fresh scene using `fallbackDoc`
 * - has `schemaVersion`  -> forward-migrate to current version
 * - has Fabric `objects` -> legacy v0 adapter
 */
export function loadScene(raw: string | null | undefined, fallbackDoc: CoverDoc): CoverScene {
  if (!raw) return freshScene(fallbackDoc);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return freshScene(fallbackDoc);
  }

  if (!parsed || typeof parsed !== "object") return freshScene(fallbackDoc);
  const obj = parsed as Record<string, unknown>;

  if (typeof obj.schemaVersion === "number") {
    return migrateForward(obj as unknown as CoverScene);
  }

  if (Array.isArray(obj.objects)) {
    return migrateLegacy(obj, fallbackDoc);
  }

  return freshScene(fallbackDoc);
}
