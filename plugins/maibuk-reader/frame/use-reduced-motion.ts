/**
 * The Reader Frame's reduced-motion signal (#943 unit 1). The host resolves
 * the app's motion preference and writes it onto the Frame's `<html>` as
 * `--maibuk-motion` (`reduce` or `no-preference`), re-sending it when the
 * preference changes. The Frame reads that token, never a media query, so it
 * follows the app's resolved choice rather than the OS's.
 *
 * The host writes the token on the root's inline style, so one MutationObserver
 * on that attribute catches every update after the value is committed.
 */

import { useEffect, useState } from "preact/hooks";

/** The public Frame token that carries the resolved motion preference. */
export const MOTION_TOKEN = "--maibuk-motion";

/** Whether the document's motion token asks for reduced motion. */
export function readReducedMotion(doc: Document = document): boolean {
  const value = getComputedStyle(doc.documentElement).getPropertyValue(MOTION_TOKEN).trim();
  return value === "reduce";
}

/** Whether the Frame should reduce motion, updated when the host changes it. */
export function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState<boolean>(readReducedMotion);

  useEffect(() => {
    const update = () => setReduce(readReducedMotion());
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
    update();
    return () => observer.disconnect();
  }, []);

  return reduce;
}
