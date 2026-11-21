/** The OS preference for reduced motion. */
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** True exactly when `root` carries `data-motion="reduce"`. */
export function prefersReducedMotion(root: HTMLElement = document.documentElement): boolean {
  return root.getAttribute("data-motion") === "reduce";
}

/** Sets `data-motion="reduce"` on `root` when `reduce`, and clears it otherwise. */
export function applyMotion(reduce: boolean, root: HTMLElement = document.documentElement): void {
  if (reduce) root.setAttribute("data-motion", "reduce");
  else root.removeAttribute("data-motion");
}
