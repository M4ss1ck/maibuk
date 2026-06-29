import type { GradientStop } from "@/features/covers/scene/schema";

/** Return a new array of stops sorted by offset ascending (input untouched). */
export function sortStops(stops: GradientStop[]): GradientStop[] {
  return [...stops].sort((a, b) => a.offset - b.offset);
}

export interface LinearCoords {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Endpoints (in object pixel space) for a linear gradient at `angle` degrees
 * across a `width`×`height` bounding box. 0deg = left→right, 90deg = top→bottom.
 */
export function linearGradientCoords(angle: number, width: number, height: number): LinearCoords {
  const rad = (angle * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const cx = width / 2;
  const cy = height / 2;
  return {
    x1: cx - (dx * width) / 2,
    y1: cy - (dy * height) / 2,
    x2: cx + (dx * width) / 2,
    y2: cy + (dy * height) / 2,
  };
}
