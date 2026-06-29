import type { CanvasPosition } from "@/features/canvas/types";

export function strokeToPath(points: CanvasPosition[]): string {
  if (points.length === 0) return "";
  const [first, ...rest] = points;
  return [`M ${first.x} ${first.y}`, ...rest.map((p) => `L ${p.x} ${p.y}`)].join(" ");
}
