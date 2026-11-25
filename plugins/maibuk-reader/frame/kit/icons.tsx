/** @jsxImportSource preact */
/**
 * The Reader Frame's icon inventory (#943 unit 2). The names and path data are
 * the design sheet's, in its gallery order, followed by the four toolbar
 * controls the gallery lacks, drawn on the same 24 px grid at 20 px with a
 * 1.75 stroke, round caps and joins, which the sheet allows. The gallery's
 * dots for `more` and `moreV` are the one exception the sheet corrects: the
 * stroke stays 1.75 for every icon.
 */

/** The path data every icon draws, keyed by the name screens use. */
const ICON_PATHS = {
  back: "M15 18l-6-6 6-6",
  fwd: "M9 18l6-6-6-6",
  down: "M6 9l6 6 6-6",
  up: "M18 15l-6-6-6 6",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  close: "M6 6l12 12M18 6L6 18",
  check: "M5 12l5 5 9-11",
  import: "M12 3v12M7 10l5 5 5-5M4 20h16",
  export: "M12 15V3M7 8l5-5 5 5M4 14v6h16v-6",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  file: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  list: "M9 6h12M9 12h12M9 18h12M4 5h2v2H4zM4 11h2v2H4zM4 17h2v2H4z",
  compact: "M3 5h18M3 10h18M3 15h18M3 20h18",
  sort: "M7 4v16M4 17l3 3 3-3M17 20V4M14 7l3-3 3 3",
  filter: "M3 5h18l-7 8v6l-4 2v-8z",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  moreV: "M12 5h.01M12 12h.01M12 19h.01",
  contents: "M4 6h16M4 12h10M4 18h14",
  bookmark: "M6 3h12v18l-6-4-6 4z",
  highlight: "M15 4l5 5-9 9H6v-5zM4 21h9",
  note: "M4 4h16v12H9l-5 4zM8 8h8M8 12h5",
  lookup: "M3 5h6a3 3 0 0 1 3 3v12a2 2 0 0 0-2-2H3zM21 5h-6a3 3 0 0 0-3 3v12a2 2 0 0 1 2-2h7z",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  text: "M3 19L8 5l5 14M5 14h6M16 11a3 3 0 0 1 5 2v6M21 15h-3a2 2 0 0 0 0 4h3",
  theme: "M12 3a9 9 0 1 0 0 18zM12 3a9 9 0 0 1 0 18",
  code: "M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16",
  stats: "M4 20V11M10 20V5M16 20v-7M21 20H3",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  collection: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5",
  fullscreen: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  tap: "M9 11V5a2 2 0 0 1 4 0v5M13 10a2 2 0 0 1 4 0v2M17 12a2 2 0 0 1 4 0v2a7 7 0 0 1-7 7h-1a7 7 0 0 1-6-3l-2.5-4a1.8 1.8 0 0 1 3-2L9 15",
  alert: "M12 3l10 18H2zM12 10v5M12 18h.01",
  relink: "M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1",
  font: "M5 20L11 4h2l6 16M7.5 14h9",
  alignLeft: "M3 6h18M3 10h12M3 14h18M3 18h12",
  justify: "M3 6h18M3 10h18M3 14h18M3 18h18",
  book: "M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11",
  pen: "M4 20l4-1 11-11-3-3L5 16zM14 6l3 3",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  sliders: "M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4",
  swap: "M7 7h13M16 3l4 4-4 4M17 17H4M8 13l-4 4 4 4",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6",
  hyphen: "M4 7h9M4 12h6M14 12h3M4 17h9",
  fitWidth: "M18 8l4 4-4 4M2 12h20M6 8l-4 4 4 4",
  fitPage: "M12 2v20M8 18l4 4 4-4M8 6l4-4 4 4",
  continuous: "M5 3h14v7H5zM5 14h14v7H5z",
  fullscreenExit:
    "M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3",
} as const;

/** Every icon screens may ask for, in the design sheet's gallery order. */
export type IconName = keyof typeof ICON_PATHS;

/** The inventory as a list, in artboard order, for galleries and cross-checks. */
export const ICON_NAMES = Object.keys(ICON_PATHS) as IconName[];

/** The props every icon takes: its inventory name. */
export interface IconProps {
  name: IconName;
}

/** One inventory icon at 20 px, hidden from assistive technology inside its control. */
export function Icon({ name }: IconProps) {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}
