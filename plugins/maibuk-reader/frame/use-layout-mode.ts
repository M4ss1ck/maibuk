/**
 * The Reader Frame's layout mode (#943 unit 1): a Pane can be narrow on a
 * desktop, so the Frame's own window width decides the mode, never the host
 * viewport or the device. Narrow sits below 600 px; Wide starts at 600 px.
 *
 * The target the chrome sizes its controls to follows the mode and the input:
 * 44 px in Narrow, 40 px in Wide with a fine pointer, and 44 px in Wide under
 * `pointer: coarse`. Both a resize and a pointer-media change recompute it.
 */

import { useEffect, useState } from "preact/hooks";

/** The first width that draws Wide. */
export const WIDE_MIN_WIDTH = 600;

/** The media that makes Wide keep the larger touch target. */
export const COARSE_POINTER_QUERY = "(pointer: coarse)";

/** Which layout the Frame's width calls for. */
export type LayoutMode = "narrow" | "wide";

/** The mode and the target its controls draw at. */
export interface FrameLayout {
  mode: LayoutMode;
  target: 40 | 44;
}

/** Reads the layout for a Frame width and pointer, defaulting to the Frame's own. */
export function readFrameLayout(
  width: number = window.innerWidth,
  coarse: boolean = window.matchMedia(COARSE_POINTER_QUERY).matches
): FrameLayout {
  const mode: LayoutMode = width >= WIDE_MIN_WIDTH ? "wide" : "narrow";
  const target = mode === "wide" && !coarse ? 40 : 44;
  return { mode, target };
}

/** The Frame's current layout mode and touch target, updated as it changes. */
export function useLayoutMode(): FrameLayout {
  const [layout, setLayout] = useState<FrameLayout>(readFrameLayout);

  useEffect(() => {
    const update = () => setLayout(readFrameLayout());
    const coarse = window.matchMedia(COARSE_POINTER_QUERY);
    window.addEventListener("resize", update);
    coarse.addEventListener("change", update);
    return () => {
      window.removeEventListener("resize", update);
      coarse.removeEventListener("change", update);
    };
  }, []);

  return layout;
}
