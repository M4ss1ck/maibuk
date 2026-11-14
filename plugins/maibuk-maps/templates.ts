/**
 * The Maps Map Templates (#754): the ready-made Maps an author starts a new Map
 * from. A Template is a set of shapes in unit coordinates, drawn by hand or, for
 * Cuba, generated from Natural Earth (#755). A hand-drawn Template sits on a
 * unit square scaled by the page's shorter side; real geography is fitted to
 * the page's own shape, so the island fills the width a landscape page has.
 * `templateElements` scales them to the page it is given and mints a fresh id
 * for every Element, and `templateStyle` names the Map Style it is drawn in.
 *
 * A Map made from a Template is a copy: nothing it holds is shared with the
 * Template, or with another Map, so editing one never touches the others. Its
 * Fills are Bucket Fills, an anchor and no outline, so each one follows the face
 * it sits in when the author moves a coastline, exactly as a poured Fill does.
 *
 * `maps.ts` imports this module for `templateElements` and `templateStyle`, and
 * this one imports `maps.ts` for its Element types and its factories: a cycle of
 * module bindings, but never of values, because each side reads the other only
 * when a function runs, never while a module evaluates.
 *
 * This module imports only its own files.
 */

import { CUBA_BORDERS, CUBA_COASTS, CUBA_PROVINCES } from "./cuba";
import { deepestPoint, findFaces } from "./faces";
import { pointsBounds } from "./geometry";
import { format, translate, type MapsKey } from "./i18n";
import {
  LINE_STYLE_DEFAULT_ENCLOSES,
  newLabel,
  newStamp,
  type LineStyleId,
  type MapElement,
  type MapFillElement,
  type MapLabelElement,
  type MapLineElement,
  type MapPoint,
} from "./maps";
import { baseStampRef, stampNameKey } from "./stamps";
import type { MapStyleId, StyleRole } from "./styles";

/** The Templates an author can start a Map from, in the order a picker lists them. */
export const MAP_TEMPLATE_IDS = [
  "continent",
  "archipelago",
  "two-continents",
  "inland-kingdom",
  "blank-sea",
  "cuba",
] as const;

/** The id of one Map Template. */
export type MapTemplateId = (typeof MAP_TEMPLATE_IDS)[number];

/** Whether a value names a Map Template this build carries. */
export function isMapTemplateId(value: unknown): value is MapTemplateId {
  return typeof value === "string" && (MAP_TEMPLATE_IDS as readonly string[]).includes(value);
}

/** The Fill role a Template face takes. */
type TemplateFillRole = Extract<StyleRole, "water" | "land" | "forest">;

/** How far the world border keeps from the page edge, as a share of each page side. */
const BORDER_INSET = 0.03;

/**
 * How far real geography keeps from the world border, as a share of the inner
 * page's width and height on each side, so a coast never touches the frame.
 */
export const GEOGRAPHY_MARGIN = 0.06;

/** The world border: a rectangle just inside the page, drawn corner to corner. */
const BORDER: readonly MapPoint[] = [
  [BORDER_INSET, BORDER_INSET],
  [1 - BORDER_INSET, BORDER_INSET],
  [1 - BORDER_INSET, 1 - BORDER_INSET],
  [BORDER_INSET, 1 - BORDER_INSET],
];

/** The cartouche's centre on the page, as a share of each page side. */
const CARTOUCHE_CENTRE: MapPoint = [0.5, 0.1];

/** The cartouche's art box width, as a share of the page width. */
const CARTOUCHE_WIDTH = 0.42;

/**
 * The cartouche art's own units (`stamp-art.ts`: its `viewBox` is 10.6 wide, and
 * its plaque path spans x -3.2 … 3.2 by y -5.2 … -3.2), which the Label takes its
 * width and size from so the title sits in the plaque.
 */
export const CARTOUCHE_ART_WIDTH = 10.6;
export const CARTOUCHE_PLAQUE_WIDTH = 6.4;
export const CARTOUCHE_PLAQUE_HEIGHT = 2;

/** The title Label's cap size as a share of the plaque's height, leaving room for ascenders. */
export const TITLE_SIZE_RATIO = 0.5;

/** The compass rose's centre on the page, as a share of each page side. */
const COMPASS_CENTRE: MapPoint = [0.88, 0.86];

/** The compass rose's art box width, as a share of the page's shorter side. */
const COMPASS_SIZE = 0.14;

/**
 * A province Label's cap size, as a share of the fitted geography's width.
 * Cuba's provinces are close together, so this is the largest share whose
 * Labels stay apart: 2.5 mm on a landscape A4 page, the size the island could
 * carry, puts two of them on each other.
 */
const PROVINCE_LABEL_SIZE_RATIO = 0.008;

/** The share of a Label's cap size one glyph takes, which sets its baseline length. */
const PROVINCE_LABEL_GLYPH_RATIO = 0.6;

/** One large landmass, its coast drawn by hand. */
const CONTINENT_COAST: readonly MapPoint[] = [
  [0.793, 0.624],
  [0.773, 0.719],
  [0.712, 0.751],
  [0.641, 0.779],
  [0.57, 0.826],
  [0.495, 0.802],
  [0.399, 0.808],
  [0.342, 0.779],
  [0.268, 0.745],
  [0.192, 0.704],
  [0.158, 0.635],
  [0.184, 0.56],
  [0.176, 0.494],
  [0.173, 0.411],
  [0.2, 0.353],
  [0.281, 0.3],
  [0.346, 0.244],
  [0.43, 0.224],
  [0.52, 0.265],
  [0.582, 0.256],
  [0.653, 0.299],
  [0.737, 0.303],
  [0.781, 0.374],
  [0.848, 0.429],
  [0.851, 0.51],
  [0.828, 0.571],
];

/** The western landmass of a Map with a sea between two continents. */
const WEST_CONTINENT_COAST: readonly MapPoint[] = [
  [0.393, 0.56],
  [0.379, 0.645],
  [0.348, 0.718],
  [0.322, 0.756],
  [0.273, 0.79],
  [0.231, 0.818],
  [0.188, 0.792],
  [0.152, 0.725],
  [0.125, 0.683],
  [0.099, 0.609],
  [0.096, 0.522],
  [0.086, 0.437],
  [0.094, 0.354],
  [0.127, 0.274],
  [0.16, 0.236],
  [0.204, 0.233],
  [0.254, 0.175],
  [0.286, 0.234],
  [0.332, 0.268],
  [0.365, 0.316],
  [0.377, 0.407],
  [0.404, 0.484],
];

/** The eastern landmass of a Map with a sea between two continents. */
const EAST_CONTINENT_COAST: readonly MapPoint[] = [
  [0.828, 0.764],
  [0.792, 0.771],
  [0.752, 0.775],
  [0.709, 0.777],
  [0.656, 0.753],
  [0.626, 0.685],
  [0.623, 0.61],
  [0.609, 0.53],
  [0.607, 0.449],
  [0.62, 0.384],
  [0.65, 0.312],
  [0.694, 0.29],
  [0.736, 0.248],
  [0.769, 0.25],
  [0.808, 0.277],
  [0.861, 0.281],
  [0.891, 0.349],
  [0.902, 0.425],
  [0.92, 0.502],
  [0.913, 0.575],
  [0.889, 0.644],
  [0.86, 0.708],
];

/** The kingdom's border, a closed line inside the page's land. */
const KINGDOM_BORDER: readonly MapPoint[] = [
  [0.393, 0.768],
  [0.333, 0.721],
  [0.27, 0.68],
  [0.245, 0.585],
  [0.233, 0.494],
  [0.275, 0.395],
  [0.313, 0.339],
  [0.371, 0.256],
  [0.443, 0.238],
  [0.536, 0.225],
  [0.612, 0.252],
  [0.675, 0.311],
  [0.705, 0.376],
  [0.749, 0.476],
  [0.764, 0.552],
  [0.718, 0.635],
  [0.706, 0.719],
  [0.647, 0.784],
  [0.553, 0.785],
  [0.466, 0.793],
];

/** A river running down the kingdom, drawn open and enclosing nothing. */
const KINGDOM_RIVER: readonly MapPoint[] = [
  [0.52, 0.33],
  [0.55, 0.4],
  [0.5, 0.46],
  [0.53, 0.53],
  [0.47, 0.6],
  [0.49, 0.66],
  [0.44, 0.71],
];

/** An island of the archipelago, the largest of the six. */
const ISLAND_ONE: readonly MapPoint[] = [
  [0.385, 0.365],
  [0.371, 0.415],
  [0.345, 0.442],
  [0.316, 0.485],
  [0.267, 0.465],
  [0.231, 0.464],
  [0.193, 0.469],
  [0.164, 0.415],
  [0.157, 0.371],
  [0.136, 0.333],
  [0.155, 0.281],
  [0.172, 0.244],
  [0.184, 0.206],
  [0.221, 0.184],
  [0.266, 0.18],
  [0.317, 0.182],
  [0.356, 0.201],
  [0.382, 0.237],
  [0.387, 0.287],
  [0.4, 0.325],
];

/** A medium island of the archipelago. */
const ISLAND_TWO: readonly MapPoint[] = [
  [0.639, 0.37],
  [0.605, 0.373],
  [0.573, 0.364],
  [0.547, 0.343],
  [0.536, 0.313],
  [0.531, 0.278],
  [0.522, 0.242],
  [0.548, 0.211],
  [0.577, 0.201],
  [0.607, 0.173],
  [0.64, 0.187],
  [0.667, 0.202],
  [0.688, 0.22],
  [0.714, 0.24],
  [0.717, 0.277],
  [0.711, 0.309],
  [0.692, 0.343],
  [0.668, 0.374],
];

/** A medium island of the archipelago, east of the others. */
const ISLAND_THREE: readonly MapPoint[] = [
  [0.745, 0.555],
  [0.734, 0.517],
  [0.719, 0.491],
  [0.708, 0.458],
  [0.726, 0.414],
  [0.744, 0.389],
  [0.776, 0.376],
  [0.808, 0.38],
  [0.841, 0.376],
  [0.862, 0.407],
  [0.886, 0.435],
  [0.89, 0.472],
  [0.88, 0.511],
  [0.857, 0.531],
  [0.84, 0.551],
  [0.807, 0.565],
  [0.78, 0.571],
];

/** A small island of the archipelago. */
const ISLAND_FOUR: readonly MapPoint[] = [
  [0.355, 0.718],
  [0.328, 0.729],
  [0.294, 0.732],
  [0.261, 0.729],
  [0.236, 0.695],
  [0.218, 0.665],
  [0.216, 0.633],
  [0.227, 0.588],
  [0.257, 0.571],
  [0.278, 0.548],
  [0.305, 0.551],
  [0.337, 0.557],
  [0.365, 0.579],
  [0.379, 0.612],
  [0.381, 0.65],
  [0.365, 0.687],
];

/** A medium island of the archipelago, south of the largest one. */
const ISLAND_FIVE: readonly MapPoint[] = [
  [0.54, 0.836],
  [0.508, 0.82],
  [0.479, 0.788],
  [0.464, 0.749],
  [0.455, 0.72],
  [0.474, 0.67],
  [0.481, 0.632],
  [0.522, 0.62],
  [0.553, 0.596],
  [0.598, 0.609],
  [0.628, 0.617],
  [0.654, 0.647],
  [0.673, 0.68],
  [0.67, 0.723],
  [0.663, 0.769],
  [0.657, 0.799],
  [0.62, 0.827],
  [0.579, 0.833],
];

/** The smallest island of the archipelago. */
const ISLAND_SIX: readonly MapPoint[] = [
  [0.119, 0.874],
  [0.117, 0.857],
  [0.108, 0.839],
  [0.125, 0.823],
  [0.144, 0.805],
  [0.158, 0.791],
  [0.186, 0.803],
  [0.203, 0.808],
  [0.223, 0.819],
  [0.236, 0.843],
  [0.222, 0.86],
  [0.215, 0.884],
  [0.199, 0.897],
  [0.177, 0.907],
  [0.153, 0.909],
  [0.135, 0.896],
];

/** One Template's shapes, in unit coordinates on the page. */
interface TemplateSpec {
  /** The Map Style the Template is drawn in. */
  style: MapStyleId;
  /** The Start from option's label. */
  labelKey: MapsKey;
  /** The Fill role of the face just inside the world border. */
  borderRole: TemplateFillRole;
  /** The Fill role of every face inside the border. */
  interiorRole: TemplateFillRole;
  /** Closed coasts inside the border, each one enclosing its own land face. */
  coasts: readonly (readonly MapPoint[])[];
  /**
   * Whether the shapes are real geography, meeting at shared vertices exactly:
   * then they are neither smoothed nor roughened, since either would pull the
   * borders off the coast they meet, and their own bounding box is what the
   * page is fitted to, so the shapes take the page's shape rather than a square.
   */
  realGeography?: boolean;
  /** Open borders inside the coasts, each end shared with a coast or another border. */
  borders?: readonly (readonly MapPoint[])[];
  /** The places a political Template names, each with the point its Label sits on. */
  provinces?: readonly { name: string; point: MapPoint }[];
  /** A kingdom's border inside the border, its face the other land face. */
  kingdom?: readonly MapPoint[];
  /** A river inside the kingdom, drawn open and enclosing nothing. */
  river?: readonly MapPoint[];
}

/** What each Template draws. */
const TEMPLATES: Readonly<Record<MapTemplateId, TemplateSpec>> = {
  continent: {
    style: "atlas",
    labelKey: "template.continent",
    borderRole: "water",
    interiorRole: "land",
    coasts: [CONTINENT_COAST],
  },
  archipelago: {
    style: "parchment",
    labelKey: "template.archipelago",
    borderRole: "water",
    interiorRole: "land",
    coasts: [ISLAND_ONE, ISLAND_TWO, ISLAND_THREE, ISLAND_FOUR, ISLAND_FIVE, ISLAND_SIX],
  },
  "two-continents": {
    style: "atlas",
    labelKey: "template.two-continents",
    borderRole: "water",
    interiorRole: "land",
    coasts: [WEST_CONTINENT_COAST, EAST_CONTINENT_COAST],
  },
  "inland-kingdom": {
    style: "parchment",
    labelKey: "template.inland-kingdom",
    borderRole: "land",
    interiorRole: "forest",
    coasts: [],
    kingdom: KINGDOM_BORDER,
    river: KINGDOM_RIVER,
  },
  "blank-sea": {
    style: "atlas",
    labelKey: "template.blank-sea",
    borderRole: "water",
    interiorRole: "land",
    coasts: [],
  },
  cuba: {
    style: "atlas",
    labelKey: "template.cuba",
    borderRole: "water",
    interiorRole: "land",
    realGeography: true,
    coasts: CUBA_COASTS,
    borders: CUBA_BORDERS,
    provinces: CUBA_PROVINCES,
  },
};

/** The Map Style a Template draws in. */
export function templateStyle(id: MapTemplateId): MapStyleId {
  return TEMPLATES[id].style;
}

/** The Start from label a Template takes. */
export function templateLabelKey(id: MapTemplateId): MapsKey {
  return TEMPLATES[id].labelKey;
}

/** The line a Template draws: its shape, its line style, and how it is inked. */
interface TemplateLineOptions {
  closed: boolean;
  smooth: boolean;
  roughened: boolean;
}

/**
 * The Elements a Map made from `id` starts with, drawn on `page`: the world
 * border, a coast per landmass (a province border per border, and a kingdom's
 * border and river, where the Template has them), one Bucket Fill per face, the
 * compass rose and title cartouche, and a Map Label writing `title` across the
 * cartouche, then one Label per province a political Template names. Element
 * names are written in `language`, the app language, exactly as the editor
 * names the Elements it makes; every call mints fresh Elements from `newId`, so
 * a Map made from a Template is a copy.
 */
export function templateElements(
  id: MapTemplateId,
  page: { widthMm: number; heightMm: number },
  title: string,
  newId: () => string,
  language = "en"
): MapElement[] {
  const spec = TEMPLATES[id];
  const realGeography = spec.realGeography === true;
  const lines: MapLineElement[] = [];

  // Land shapes are authored on a unit square. A hand-drawn Template scales
  // that square by the shorter inner side, which keeps its aspect on every page
  // and stays inside the page border. Real geography instead fills the page
  // shape it is drawn on: its own bounding box, not the square around it, is
  // fitted to the area the page border leaves, so a long island takes the whole
  // width of a landscape page.
  const innerWidth = page.widthMm * (1 - 2 * BORDER_INSET);
  const innerHeight = page.heightMm * (1 - 2 * BORDER_INSET);
  /** The factor from unit coordinates to page millimetres, and the page point it starts at. */
  let landSize = 0;
  let landOrigin: MapPoint = [0, 0];
  /** The land's drawn width, which a province Label is sized from. */
  let landWidth = 0;
  if (realGeography) {
    const bounds = pointsBounds(spec.coasts.flat());
    // Real geography always has at least one coast: there is nothing to fit without one.
    if (bounds === null) throw new Error(`The ${id} Template has no coasts to fit.`);
    const unitWidth = bounds.maxX - bounds.minX;
    const unitHeight = bounds.maxY - bounds.minY;
    const fitWidth = innerWidth * (1 - 2 * GEOGRAPHY_MARGIN);
    const fitHeight = innerHeight * (1 - 2 * GEOGRAPHY_MARGIN);
    landSize = Math.min(fitWidth / unitWidth, fitHeight / unitHeight);
    landWidth = unitWidth * landSize;
    landOrigin = [
      page.widthMm * BORDER_INSET +
        GEOGRAPHY_MARGIN * innerWidth +
        (fitWidth - landWidth) / 2 -
        bounds.minX * landSize,
      page.heightMm * BORDER_INSET +
        GEOGRAPHY_MARGIN * innerHeight +
        (fitHeight - unitHeight * landSize) / 2 -
        bounds.minY * landSize,
    ];
  } else {
    landSize = Math.min(innerWidth, innerHeight);
    landWidth = landSize;
    landOrigin = [(page.widthMm - landSize) / 2, (page.heightMm - landSize) / 2];
  }
  const landToPage = (points: readonly MapPoint[]): MapPoint[] =>
    points.map(([x, y]): MapPoint => [landOrigin[0] + x * landSize, landOrigin[1] + y * landSize]);

  // The border keeps to the page's own shape, just inside its edge.
  const borderToPage = (points: readonly MapPoint[]): MapPoint[] =>
    points.map(([x, y]): MapPoint => [x * page.widthMm, y * page.heightMm]);

  const line = (points: MapPoint[], style: LineStyleId, options: TemplateLineOptions): void => {
    const segments = points.length - 1 + (options.closed ? 1 : 0);
    lines.push({
      id: newId(),
      kind: "line",
      name: format(translate(language, "element.lineName"), { number: lines.length + 1 }),
      hidden: false,
      locked: false,
      points,
      style,
      enclosesFills: LINE_STYLE_DEFAULT_ENCLOSES[style],
      closed: options.closed,
      curves: Array.from({ length: segments }, () => options.smooth),
      roughened: options.roughened,
    });
  };

  // A coast line belongs only where sea meets land: an inland Template's border
  // traces land, so it takes the most neutral ordinary line instead.
  const borderStyle: LineStyleId = spec.borderRole === "water" ? "coast" : "plain";
  line(borderToPage(BORDER), borderStyle, { closed: true, smooth: false, roughened: false });
  for (const coast of spec.coasts) {
    // Real geography is drawn as surveyed, so smoothing or roughening it would
    // pull the borders that meet it off the coast.
    line(landToPage(coast), "coast", {
      closed: true,
      smooth: !realGeography,
      roughened: !realGeography,
    });
  }
  if (spec.kingdom !== undefined) {
    line(landToPage(spec.kingdom), "border", { closed: true, smooth: true, roughened: true });
  }
  if (spec.river !== undefined) {
    line(landToPage(spec.river), "river", { closed: false, smooth: true, roughened: true });
  }
  for (const border of spec.borders ?? []) {
    line(landToPage(border), "border", { closed: false, smooth: false, roughened: false });
  }

  // The largest face is the one just inside the world border: the sea, or, in a
  // Template with no sea, the outer land. Every face inside it takes the
  // Template's interior role.
  const faces = findFaces(lines).sort((one, two) => two.area - one.area);
  const fills: MapFillElement[] = faces.map((face, index) => ({
    id: newId(),
    kind: "fill",
    name: format(translate(language, "element.fillName"), { number: index + 1 }),
    hidden: false,
    locked: false,
    anchor: deepestPoint(face),
    content: { color: index === 0 ? spec.borderRole : spec.interiorRole },
  }));

  const cartouchePoint: MapPoint = [
    CARTOUCHE_CENTRE[0] * page.widthMm,
    CARTOUCHE_CENTRE[1] * page.heightMm,
  ];
  const cartoucheSize = page.widthMm * CARTOUCHE_WIDTH;
  const cartouche = newStamp({
    id: newId(),
    name: translate(language, stampNameKey("cartouche")),
    stampRef: baseStampRef("cartouche"),
    point: cartouchePoint,
    size: cartoucheSize,
  });
  const compass = newStamp({
    id: newId(),
    name: translate(language, stampNameKey("compass-rose")),
    stampRef: baseStampRef("compass-rose"),
    point: [COMPASS_CENTRE[0] * page.widthMm, COMPASS_CENTRE[1] * page.heightMm],
    size: Math.min(page.widthMm, page.heightMm) * COMPASS_SIZE,
  });
  const titleLabel = newLabel({
    id: newId(),
    name: format(translate(language, "element.labelName"), { number: 1 }),
    text: title,
    point: cartouchePoint,
    // The title keeps to the cartouche's plaque, wrapping inside it (#800).
    width: cartoucheSize * (CARTOUCHE_PLAQUE_WIDTH / CARTOUCHE_ART_WIDTH),
    sizing: "fixed",
    size: cartoucheSize * (CARTOUCHE_PLAQUE_HEIGHT / CARTOUCHE_ART_WIDTH) * TITLE_SIZE_RATIO,
  });
  const provinceSize = landWidth * PROVINCE_LABEL_SIZE_RATIO;
  const provinceLabels: MapLabelElement[] = (spec.provinces ?? []).map((province, index) =>
    newLabel({
      id: newId(),
      name: format(translate(language, "element.labelName"), { number: index + 2 }),
      text: province.name,
      point: landToPage([province.point])[0],
      width: province.name.length * provinceSize * PROVINCE_LABEL_GLYPH_RATIO,
      size: provinceSize,
    })
  );

  return [...fills, ...lines, cartouche, compass, titleLabel, ...provinceLabels];
}
