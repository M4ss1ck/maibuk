/** @jsxImportSource preact */
/**
 * The dev-only bootstrap for the Reader component gallery (#943 unit 5). It
 * reads the screenshot query params, writes the same document-root attributes
 * and tokens the real Frame uses, and mounts the public Gallery.
 *
 * `theme=dark` picks Maibuk Dark; `reading=light|sepia|dark|black` picks the
 * Reading Theme; `eink=1` turns E-ink Mode on; `motion=reduce` stops motion.
 * E-ink Mode offers Light and Black only, so any other Reading Theme
 * normalizes to Light, matching Page.dc.html.
 */

import { render } from "preact";
import { Gallery } from "./gallery";

export type GalleryColorScheme = "light" | "dark";

export type GalleryReadingTheme = "light" | "sepia" | "dark" | "black";

export type GalleryMotion = "reduce" | "no-preference";

/** The environment the gallery page draws with. */
export interface GalleryEnvironment {
  colorScheme: GalleryColorScheme;
  reading: GalleryReadingTheme;
  eink: boolean;
  motion: GalleryMotion;
}

const READING_THEMES: readonly GalleryReadingTheme[] = ["light", "sepia", "dark", "black"];

function isReadingTheme(value: string): value is GalleryReadingTheme {
  return (READING_THEMES as readonly string[]).includes(value);
}

/** Reads the gallery's query params, defaulting to Maibuk Light and reading light. */
export function readGalleryEnvironment(search: string): GalleryEnvironment {
  const params = new URLSearchParams(search);
  const colorScheme: GalleryColorScheme = params.get("theme") === "dark" ? "dark" : "light";
  const requested = params.get("reading");
  let reading: GalleryReadingTheme =
    requested !== null && isReadingTheme(requested) ? requested : "light";
  const eink = params.get("eink") === "1";
  if (eink && reading !== "black") reading = "light";
  const motion: GalleryMotion = params.get("motion") === "reduce" ? "reduce" : "no-preference";
  return { colorScheme, reading, eink, motion };
}

/**
 * Writes the Frame's document-root signals. `FrameRoot` publishes
 * `data-color-scheme`, `data-eink`, and `data-motion`; the host publishes the
 * Reading Theme and the `--maibuk-*` tokens the Frame inherits.
 */
export function applyGalleryEnvironment(
  environment: GalleryEnvironment,
  root: HTMLElement = document.documentElement
): void {
  root.dataset.colorScheme = environment.colorScheme;
  root.dataset.eink = String(environment.eink);
  root.dataset.motion = environment.motion;
  root.dataset.readingTheme = environment.reading;
  root.style.setProperty("--maibuk-color-scheme", environment.colorScheme);
  root.style.setProperty("--maibuk-motion", environment.motion);
}

const galleryRoot = document.getElementById("gallery-root");
if (galleryRoot) {
  applyGalleryEnvironment(readGalleryEnvironment(window.location.search));
  render(<Gallery />, galleryRoot);
}
