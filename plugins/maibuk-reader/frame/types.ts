/**
 * The Reader Frame's shared Document shapes (#941): what the Worker hands the
 * Frame to draw, and where the author was in it. Every Frame module that draws
 * or reports a Document takes these instead of declaring its own copy.
 *
 * These mirror `../frame-protocol.ts`, the Plugin Worker's copy. The Frame may
 * not import it (see `entry.ts`), so the shapes stay duplicated; a change lands
 * on both sides at once.
 */

/** The page fit a fresh Document opens with, or a numeric zoom scale. */
export type FrameZoom = number | "width" | "page";

/** Where the author was in a fixed-page Document. */
export interface PagePosition {
  kind: "page";
  page: number;
  zoom: FrameZoom;
}

/** Where the author was in a reflowable Document, by its canonical fragment identifier. */
export interface CfiPosition {
  kind: "cfi";
  cfi: string;
}

/** Where the author was in a format with no fragment identifier, by spine index. */
export interface SectionPosition {
  kind: "section";
  index: number;
  fraction: number;
}

/** Where the author was in a Document. */
export type ReadingPosition = PagePosition | CfiPosition | SectionPosition;

/** The Document fields the Frame draws. */
export interface FrameEntry {
  id: string;
  title: string;
  author: string;
  format: string;
}

/** The Reader settings the Worker hands the Frame. */
export interface ReaderSettings {
  fontSize: number;
  lineWidth: string;
  pdfFit: "width" | "page";
  pdfLayout: "single" | "continuous";
}

/** The pdf.js resources the Worker hands the Frame when a PDF opens. */
export interface FramePdf {
  displaySource: string;
  css: string;
}

/** The modules the Frame evaluates for a reflowable or fixed-layout Document. */
export interface FrameFoliate {
  source: string;
  purify: string;
}

/** One entry in the archive a reflowable Document is packed in. */
export interface FrameZipEntry {
  name: string;
  size: number;
}

/** The localized UI strings the Frame shows, built by the Worker from i18n. */
export interface FrameLabels {
  back: string;
  contents: string;
  contentsEmpty: string;
  find: string;
  searchPlaceholder: string;
  searchNext: string;
  searchPrevious: string;
  searchClose: string;
  searchNoMatches: string;
  searchMatches: string;
  pageOf: string;
  pageLabeled: string;
  zoomIn: string;
  zoomOut: string;
  fitWidth: string;
  fitPage: string;
  zoomLevel: string;
  loading: string;
  empty: string;
  previousPage: string;
  nextPage: string;
  passwordTitle: string;
  passwordLabel: string;
  passwordSubmit: string;
  passwordWrong: string;
  errorCorrupt: string;
  errorEncrypted: string;
  errorUnsupported: string;
  errorGeneric: string;
  errorDrm: string;
  errorDamaged: string;
  errorTooLarge: string;
  errorTimeout: string;
  sectionPage: string;
  increaseFontSize: string;
  decreaseFontSize: string;
  continuousScroll: string;
  fullScreen: string;
  exitFullScreen: string;
}
