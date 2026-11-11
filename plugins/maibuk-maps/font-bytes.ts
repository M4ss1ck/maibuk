/**
 * The bundled Map Label fonts as bytes (#753), so an SVG export can embed the
 * letterforms the Frame draws. The Plugin ships the four faces under
 * `assets/ui/fonts/`, where the Frame's `fonts.css` loads them from; the Worker
 * cannot fetch a file the way the Frame does, so each face is imported here as
 * `?inline`, which the Vite build turns into a base64 data URI inside the one
 * Worker bundle (the same shape the Reader's vendored sources take,
 * `plugins/maibuk-reader/loaders.ts`).
 *
 * The data URIs stay strings until an export first asks for the bytes: decoding
 * every face costs about half a megabyte of heap, and most sessions never
 * export an SVG. The family names are the ones `MAP_LABEL_FONT_FAMILIES` gives
 * the scene, so a face is embedded under the family a Map Label draws in.
 */

import cinzel from "./assets/ui/fonts/Cinzel-wght.ttf?inline";
import imFellEnglish from "./assets/ui/fonts/IMFeENrm28P.ttf?inline";
import medievalSharp from "./assets/ui/fonts/MedievalSharp.ttf?inline";
import uncialAntiqua from "./assets/ui/fonts/UncialAntiqua-Regular.ttf?inline";
import type { ExportFont } from "./export";
import { MAP_LABEL_FONT_FAMILIES } from "./maps";

/** Each bundled face's inlined file, keyed by the family a Map Label names. */
const INLINED_FONT_FILES: Readonly<Record<string, string>> = {
  [MAP_LABEL_FONT_FAMILIES["im-fell-english"]]: imFellEnglish,
  [MAP_LABEL_FONT_FAMILIES.cinzel]: cinzel,
  [MAP_LABEL_FONT_FAMILIES["uncial-antiqua"]]: uncialAntiqua,
  [MAP_LABEL_FONT_FAMILIES["medieval-sharp"]]: medievalSharp,
};

/** The bytes every bundled face has been decoded to, once an export asks. */
let decodedFonts: readonly ExportFont[] | null = null;

/** The four bundled faces as bytes, each decoded on the first call and kept. */
export function bundledFonts(): readonly ExportFont[] {
  decodedFonts ??= Object.entries(INLINED_FONT_FILES).map(([family, data]) => ({
    family,
    ...decodeDataUri(data),
  }));
  return decodedFonts;
}

/** The mime type and bytes a `data:` URI carries. */
function decodeDataUri(data: string): { bytes: Uint8Array; mime: string } {
  const comma = data.indexOf(",");
  if (!data.startsWith("data:") || comma === -1) {
    throw new Error("a bundled font is not an inlined data URI");
  }
  const mime = data.slice("data:".length, data.indexOf(";")) || "font/ttf";
  const binary = atob(data.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return { bytes, mime };
}
