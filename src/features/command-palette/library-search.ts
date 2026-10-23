import {
  searchPalette,
  type PaletteIndex,
  type PalettePage,
  type PaletteSection,
} from "@/features/command-palette/palette-index";

export interface SearchLibraryOptions {
  index: PaletteIndex;
  /** What the author typed, without the Commands prefix. */
  query: string;
  /** The nested page narrowing the results, or "root" for every kind. */
  page: PalettePage;
  recent: readonly string[];
  openBookId?: string | null;
}

/**
 * The one seam Library Search reads through. Today it ranks title matches over
 * the palette index; the text index and the Text section join here in a later
 * ticket, so the palette never grows a second path into the Library.
 */
export function searchLibrary({
  index,
  query,
  page,
  recent,
  openBookId,
}: SearchLibraryOptions): PaletteSection[] {
  return searchPalette(index, { mode: "library", query, page, recent, openBookId });
}
