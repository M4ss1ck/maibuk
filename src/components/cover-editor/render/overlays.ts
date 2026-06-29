import { type FabricObject, Line, Rect } from "fabric";
import type { CoverDoc } from "../../../features/covers/scene/schema";

const GUIDE_COLOR = "#e94560";
const SAFE_COLOR = "rgba(233, 69, 96, 0.5)";

function markHelper(obj: FabricObject): FabricObject {
  obj.set({ selectable: false, evented: false, hoverCursor: "default" });
  (obj as FabricObject & { helper?: boolean }).helper = true;
  return obj;
}

/** Non-interactive bleed/safe-margin overlay objects drawn above the artwork. */
export function buildOverlays(doc: CoverDoc): FabricObject[] {
  const out: FabricObject[] = [];
  const m = doc.safeMargin;
  if (m > 0) {
    out.push(
      markHelper(
        new Rect({
          left: m,
          top: m,
          width: doc.width - m * 2,
          height: doc.height - m * 2,
          fill: "transparent",
          stroke: SAFE_COLOR,
          strokeWidth: 1.5,
          strokeUniform: true,
          strokeDashArray: [10, 8],
        })
      )
    );
  }
  return out;
}

/** A full-length snap guide line (vertical at x, or horizontal at y). */
export function buildGuideLine(orientation: "v" | "h", pos: number, doc: CoverDoc): FabricObject {
  const coords: [number, number, number, number] =
    orientation === "v" ? [pos, 0, pos, doc.height] : [0, pos, doc.width, pos];
  return markHelper(
    new Line(coords, {
      stroke: GUIDE_COLOR,
      strokeWidth: 1,
      strokeUniform: true,
      selectable: false,
      evented: false,
    })
  );
}

export function isHelper(obj: FabricObject): boolean {
  return Boolean((obj as FabricObject & { helper?: boolean }).helper);
}
