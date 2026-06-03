import { type FabricObject, IText } from "fabric";
import type { Layer } from "../../../features/covers/scene/schema";

/**
 * Read geometry from a Fabric object back into a scene-layer patch.
 *
 * Fabric tracks size via scaleX/scaleY; we normalize that back into width/height
 * (top-left bbox in doc px) so the scene schema stays scale-free and subsequent
 * edits remain consistent. The object's scale is reset to 1 here as a side effect.
 */
export function readGeometry(obj: FabricObject): { id: string; patch: Partial<Layer> } | null {
  const id = (obj as FabricObject & { layerId?: string }).layerId;
  if (!id) return null;

  const width = obj.getScaledWidth();
  const height = obj.getScaledHeight();

  const patch: Partial<Layer> = {
    x: obj.left ?? 0,
    y: obj.top ?? 0,
    rotation: obj.angle ?? 0,
    width,
    height,
    opacity: obj.opacity ?? 1,
  };

  if (obj instanceof IText) {
    (patch as Partial<Layer> & { text?: string }).text = obj.text ?? "";
  }

  return { id, patch };
}
