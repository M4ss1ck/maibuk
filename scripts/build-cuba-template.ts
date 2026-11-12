/**
 * The build script behind the Cuba Map Template (#755). It reads Natural
 * Earth's 1:10m admin-1 states and provinces, keeps the sixteen Cuban
 * features, and writes `plugins/maibuk-maps/cuba.ts`: the coasts, the
 * province borders, and one label point per province, all in unit
 * coordinates.
 *
 * The pipeline is the TopoJSON one, on exact source coordinates. Every shared
 * border is cut into arcs at the vertices where the set of provinces using
 * them changes, so the two provinces that share it hand back the same arc,
 * and an arc used twice is a border. The coast arcs that remain, one
 * province each, rejoin into one closed ring per island. Douglas-Peucker then
 * thins each arc with its junction ends pinned, so coasts and borders stay
 * joined. Projection and rounding happen last, because a junction is the same
 * source coordinate on both sides and must round to the same point.
 *
 * `pnpm build:cuba-template` downloads the pinned file (or takes
 * `--input <path>`) and checks its sha256; the generated module is committed.
 *
 * Run: pnpm build:cuba-template [--input <path>]
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import polylabel from "polylabel";
import type { MapPoint } from "../plugins/maibuk-maps/maps";

/** The pinned Natural Earth admin-1 file, and the hash a build must match. */
const SOURCE_URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/ca96624a56bd078437bca8184e78163e5039ad19/geojson/ne_10m_admin_1_states_provinces.geojson";
const SOURCE_SHA256 = "22d0e3ad85eb3e27f17cabf8ba2d50e554fbc27a87796ff891d958185da62fb5";
const SOURCE_COMMIT = "ca96624a56bd078437bca8184e78163e5039ad19";

const OUTPUT = join(import.meta.dirname, "../plugins/maibuk-maps/cuba.ts");

/** Cuba has fifteen provinces and Isla de la Juventud; anything else is a wrong source. */
export const PROVINCE_COUNT = 16;

/** A kept island is at least this share of its province's largest polygon; the source's biggest islet is 5.3%. */
const KEPT_ISLAND_SHARE = 0.1;

/** Names Natural Earth still carries from before the 2011 renaming. */
const RENAMED: Readonly<Record<string, string>> = { "Ciudad de la Habana": "La Habana" };

/** Douglas-Peucker tolerance in source degrees, about 550 m on Cuba. */
export const SIMPLIFY_TOLERANCE_DEGREES = 0.005;

/** How fine the label point search is, in unit-square coordinates. */
const LABEL_PRECISION = 0.001;

export type CubaFeature = {
  properties: { adm0_a3: string; name: string; iso_3166_2: string };
} & (
  | { geometry: { type: "Polygon"; coordinates: number[][][] } }
  | { geometry: { type: "MultiPolygon"; coordinates: number[][][][] } }
);

/** One province's kept islands, largest first, in source longitude and latitude. */
export interface CubaProvince {
  iso: string;
  name: string;
  rings: MapPoint[][];
}

/** The pieces a border or coast is cut into, and the islands the coast arcs rejoin into. */
export interface Topology {
  /** Coast stretches between junctions; an island with no junction is one closed stretch. */
  coastArcs: MapPoint[][];
  /** One closed ring per island, the first point not repeated. */
  coasts: MapPoint[][];
  /** One open arc per border two provinces share. */
  borders: MapPoint[][];
}

/** One province's label point, in unit coordinates. */
export interface CubaLabel {
  iso: string;
  name: string;
  point: MapPoint;
}

/** Everything the generated module exports, before it is written out. */
export interface CubaModuleData {
  coasts: MapPoint[][];
  borders: MapPoint[][];
  provinces: CubaLabel[];
}

function compare(one: string, two: string): number {
  return one < two ? -1 : one > two ? 1 : 0;
}

function pointKey(point: MapPoint): string {
  return `${point[0]},${point[1]}`;
}

function samePoint(one: MapPoint, two: MapPoint): boolean {
  return one[0] === two[0] && one[1] === two[1];
}

function sequenceKey(points: readonly MapPoint[]): string {
  return points.map(pointKey).join("|");
}

/** The ring without its repeated closing point. */
function openRing(ring: readonly MapPoint[]): MapPoint[] {
  if (ring.length > 1 && samePoint(ring[0], ring[ring.length - 1])) return ring.slice(0, -1);
  return ring.slice();
}

function ringArea(ring: readonly MapPoint[]): number {
  let total = 0;
  for (let index = 0; index < ring.length - 1; index++) {
    total += ring[index][0] * ring[index + 1][1] - ring[index + 1][0] * ring[index][1];
  }
  return Math.abs(total / 2);
}

/** The outer rings of every polygon of a feature: Natural Earth holes are not drawn. */
function outerRings(feature: CubaFeature): MapPoint[][] {
  const polygons: number[][][][] =
    feature.geometry.type === "MultiPolygon"
      ? feature.geometry.coordinates
      : [feature.geometry.coordinates];
  return polygons.map((polygon) =>
    polygon[0].map(([longitude, latitude]) => [longitude, latitude] as MapPoint)
  );
}

/**
 * The sixteen Cuban features, renamed and with their islets dropped, sorted by
 * ISO code: fifteen provinces and Isla de la Juventud.
 */
export function selectProvinces(features: readonly CubaFeature[]): CubaProvince[] {
  const cuba = features.filter((feature) => feature.properties.adm0_a3 === "CUB");
  if (cuba.length !== PROVINCE_COUNT) {
    throw new Error(
      `The source carries ${cuba.length} Cuba features; expected the ${PROVINCE_COUNT} of Natural Earth's admin-1 file.`
    );
  }
  return cuba
    .map((feature) => {
      const rings = outerRings(feature);
      const areas = rings.map(ringArea);
      const largest = Math.max(...areas);
      const kept = rings
        .map((ring, index) => ({ ring, area: areas[index] }))
        .filter((entry) => entry.area >= largest * KEPT_ISLAND_SHARE)
        .sort((one, two) => two.area - one.area)
        .map((entry) => entry.ring);
      return {
        iso: feature.properties.iso_3166_2,
        name: RENAMED[feature.properties.name] ?? feature.properties.name,
        rings: kept,
      };
    })
    .sort((one, two) => compare(one.iso, two.iso));
}

/** The stretch of `points` from `start` to `end`, wrapping past the last vertex. */
function arcBetween(points: readonly MapPoint[], start: number, end: number): MapPoint[] {
  const arc: MapPoint[] = [];
  let index = start;
  for (;;) {
    arc.push(points[index]);
    if (index === end) break;
    index = (index + 1) % points.length;
  }
  return arc;
}

/**
 * The coast arcs and borders of a set of province rings. Vertices are keyed by
 * their exact source coordinate, so two provinces that share a stretch of
 * border hand back the same arc; arcs used by one ring are coast, arcs used by
 * two are borders.
 */
export function buildTopology(rings: readonly (readonly MapPoint[])[]): Topology {
  const users = new Map<string, Set<number>>();
  rings.forEach((ring, ringIndex) => {
    for (const point of openRing(ring)) {
      const key = pointKey(point);
      const set = users.get(key) ?? new Set<number>();
      set.add(ringIndex);
      users.set(key, set);
    }
  });

  const arcs = new Map<string, { points: MapPoint[]; uses: number }>();
  const addArc = (points: MapPoint[]): void => {
    const forward = sequenceKey(points);
    const backward = sequenceKey([...points].reverse());
    const key = forward < backward ? forward : backward;
    const arc = arcs.get(key);
    if (arc) arc.uses += 1;
    else arcs.set(key, { points, uses: 1 });
  };

  rings.forEach((ring) => {
    const points = openRing(ring);
    const sets = points.map((point) =>
      [...(users.get(pointKey(point)) ?? [])].sort((one, two) => one - two).join(",")
    );
    const junction = points.map((_point, index) => {
      const previous = sets[(index + points.length - 1) % points.length];
      const next = sets[(index + 1) % points.length];
      return sets[index] !== previous || sets[index] !== next;
    });
    const starts = junction.flatMap((isJunction, index) => (isJunction ? [index] : []));
    // An island no other province touches is its whole ring, with no junction to cut at.
    if (starts.length === 0) {
      addArc([...points, points[0]]);
      return;
    }
    for (let order = 0; order < starts.length; order++) {
      addArc(arcBetween(points, starts[order], starts[(order + 1) % starts.length]));
    }
  });

  const coastArcs: MapPoint[][] = [];
  const borders: MapPoint[][] = [];
  for (const arc of arcs.values()) {
    if (arc.uses === 1) coastArcs.push(arc.points);
    else if (arc.uses === 2) borders.push(arc.points);
    else {
      throw new Error(
        `An arc lies on ${arc.uses} rings; Natural Earth neighbours must share each border exactly once.`
      );
    }
  }
  return { coastArcs, coasts: joinCoastArcs(coastArcs), borders };
}

/**
 * Joins coast arcs end to end into one closed ring per island. A junction in a
 * coast ring has exactly two coast arcs, because the border arcs that also met
 * there were removed, so the walk is unambiguous; a ring with no junction at
 * all arrives closed and is already an island.
 */
function joinCoastArcs(arcs: readonly (readonly MapPoint[])[]): MapPoint[][] {
  const rings: MapPoint[][] = [];
  const open: MapPoint[][] = [];
  for (const arc of arcs) {
    if (arc.length > 2 && samePoint(arc[0], arc[arc.length - 1])) rings.push(openRing(arc));
    else open.push([...arc]);
  }
  const byEnd = new Map<string, number[]>();
  open.forEach((arc, index) => {
    for (const end of [arc[0], arc[arc.length - 1]]) {
      const key = pointKey(end);
      const list = byEnd.get(key) ?? [];
      list.push(index);
      byEnd.set(key, list);
    }
  });

  const used = new Set<number>();
  for (let index = 0; index < open.length; index++) {
    if (used.has(index)) continue;
    const first = open[index];
    const ring: MapPoint[] = [...first];
    used.add(index);
    let end = first[first.length - 1];
    for (;;) {
      if (samePoint(end, ring[0])) break;
      const candidates = (byEnd.get(pointKey(end)) ?? []).filter((other) => !used.has(other));
      if (candidates.length !== 1) {
        throw new Error(
          `The coast at ${pointKey(end)} meets ${candidates.length} unused arcs; it should close into one ring.`
        );
      }
      const arc = open[candidates[0]];
      used.add(candidates[0]);
      const aligned = samePoint(arc[0], end) ? arc : [...arc].reverse();
      ring.push(...aligned.slice(1));
      end = aligned[aligned.length - 1];
    }
    rings.push(ring.slice(0, -1));
  }
  return rings;
}

/** The squared distance from `point` to the segment `start`-`end`. */
function squaredDistance(point: MapPoint, start: MapPoint, end: MapPoint): number {
  const runX = end[0] - start[0];
  const runY = end[1] - start[1];
  const lengthSquared = runX * runX + runY * runY;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((point[0] - start[0]) * runX + (point[1] - start[1]) * runY) / lengthSquared)
        );
  return (point[0] - start[0] - t * runX) ** 2 + (point[1] - start[1] - t * runY) ** 2;
}

/** Douglas-Peucker on one arc, both ends pinned so a junction stays a junction. */
export function simplifyArc(points: readonly MapPoint[], tolerance: number): MapPoint[] {
  if (points.length <= 2) return [...points];
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop() as [number, number];
    let farthest = -1;
    let biggest = 0;
    for (let index = start + 1; index < end; index++) {
      const distance = squaredDistance(points[index], points[start], points[end]);
      if (distance > biggest) {
        biggest = distance;
        farthest = index;
      }
    }
    if (farthest !== -1 && Math.sqrt(biggest) > tolerance) {
      keep[farthest] = 1;
      stack.push([start, farthest], [farthest, end]);
    }
  }
  return points.filter((_point, index) => keep[index] === 1);
}

/**
 * The equirectangular projector that fits the given rings into the unit square:
 * `x = longitude * cos(mean latitude)`, `y = -latitude`, then one uniform scale
 * so the wider side spans 1 and the other axis sits centred.
 */
export function projectCuba(
  rings: readonly (readonly MapPoint[])[]
): (point: MapPoint) => MapPoint {
  let latitudeSum = 0;
  let count = 0;
  for (const ring of rings) {
    for (const point of ring) {
      latitudeSum += point[1];
      count += 1;
    }
  }
  const cos = Math.cos(((latitudeSum / count) * Math.PI) / 180);
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const ring of rings) {
    for (const point of ring) {
      const x = point[0] * cos;
      const y = -point[1];
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  const scale = 1 / Math.max(maxX - minX, maxY - minY);
  const offsetX = (1 - (maxX - minX) * scale) / 2;
  const offsetY = (1 - (maxY - minY) * scale) / 2;
  return ([longitude, latitude]) => [
    (longitude * cos - minX) * scale + offsetX,
    (-latitude - minY) * scale + offsetY,
  ];
}

function roundPoint(point: MapPoint): MapPoint {
  return [Number(point[0].toFixed(4)), Number(point[1].toFixed(4))];
}

/** The same ring written the same way whichever vertex and direction it starts from. */
function canonicalRing(ring: readonly MapPoint[]): MapPoint[] {
  let start = 0;
  for (let index = 1; index < ring.length; index++) {
    if (pointKey(ring[index]) < pointKey(ring[start])) start = index;
  }
  const forward = [...ring.slice(start), ...ring.slice(0, start)];
  const backward = [forward[0], ...forward.slice(1).reverse()];
  return compare(sequenceKey(forward), sequenceKey(backward)) <= 0 ? forward : backward;
}

/** The same open arc written the same way whichever direction it runs. */
function canonicalArc(arc: readonly MapPoint[]): MapPoint[] {
  const backward = [...arc].reverse();
  return compare(sequenceKey(arc), sequenceKey(backward)) <= 0 ? [...arc] : backward;
}

/**
 * The unit-square shapes and label points of the given provinces: coast rings,
 * border arcs, and one label per province, sorted so the output never depends
 * on the order the source listed its features.
 */
export function buildCubaModuleData(provinces: readonly CubaProvince[]): CubaModuleData {
  const ordered = [...provinces].sort((one, two) => compare(one.iso, two.iso));
  const rings = ordered.flatMap((province) => province.rings);
  const project = projectCuba(rings);
  const topology = buildTopology(rings);

  // Douglas-Peucker pins each arc's ends: an open arc ends at junctions, and a
  // closed arc's first and last point are the same, so the ring stays closed.
  const coastArcs = topology.coastArcs.map((arc) => simplifyArc(arc, SIMPLIFY_TOLERANCE_DEGREES));
  const coasts = joinCoastArcs(coastArcs)
    .map((ring) => canonicalRing(ring.map((point) => roundPoint(project(point)))))
    .sort((one, two) => compare(sequenceKey(one), sequenceKey(two)));
  const borders = topology.borders
    .map((arc) =>
      canonicalArc(
        simplifyArc(arc, SIMPLIFY_TOLERANCE_DEGREES).map((point) => roundPoint(project(point)))
      )
    )
    .sort((one, two) => compare(sequenceKey(one), sequenceKey(two)));
  const labels = ordered.map((province) => {
    // `deepestPoint` in faces.ts fixes its precision at 0.1 mm, far too coarse for
    // a unit square, so this calls the same polylabel library at a fitting precision.
    const [x, y] = polylabel([province.rings[0].map((point) => project(point))], LABEL_PRECISION);
    return { iso: province.iso, name: province.name, point: roundPoint([x, y]) };
  });

  return { coasts, borders, provinces: labels };
}

const GENERATED_HEADER = `/**
 * Generated by scripts/build-cuba-template.ts (\`pnpm build:cuba-template\`).
 * Do not edit by hand: regenerate it from Natural Earth instead.
 *
 * Cuba's provinces from Natural Earth 1:10m Admin 1 states and provinces,
 * public domain (https://www.naturalearthdata.com/), pinned at commit
 * ${SOURCE_COMMIT}. Coordinates are a unit square fitted to Cuba.
 */
// biome-ignore-all lint/suspicious/noApproximativeNumericConstant: these are map coordinates, not approximations of maths constants.`;

function renderRing(ring: readonly MapPoint[]): string[] {
  return ["  [", ...ring.map(([x, y]) => `    [${x}, ${y}],`), "  ],"];
}

function renderRings(name: string, rings: readonly (readonly MapPoint[])[]): string {
  const type = "readonly (readonly MapPoint[])[]";
  if (rings.length === 0) return `export const ${name}: ${type} = [];`;
  return [
    `export const ${name}: ${type} = [`,
    ...rings.flatMap((ring) => renderRing(ring)),
    "];",
  ].join("\n");
}

/** The generated module's text: Biome formatted, so `pnpm lint` takes it as written. */
export function renderCubaModule(data: CubaModuleData): string {
  const provinces = data.provinces.map(
    (province) =>
      `  { name: ${JSON.stringify(province.name)}, point: [${province.point[0]}, ${province.point[1]}] },`
  );
  return [
    GENERATED_HEADER,
    'import type { MapPoint } from "./maps";',
    "",
    renderRings("CUBA_COASTS", data.coasts),
    "",
    renderRings("CUBA_BORDERS", data.borders),
    "",
    [
      "export const CUBA_PROVINCES: readonly { name: string; point: MapPoint }[] = [",
      ...provinces,
      "];",
    ].join("\n"),
    "",
  ].join("\n");
}

/** The whole build, from parsed source features to the module's text. */
export function buildCubaModule(features: readonly CubaFeature[]): string {
  return renderCubaModule(buildCubaModuleData(selectProvinces(features)));
}

function parseInput(args: readonly string[]): string | null {
  if (args.length === 0) return null;
  if (args.length === 2 && args[0] === "--input") return args[1];
  throw new Error(`Usage: pnpm build:cuba-template [--input <path>] (got: ${args.join(" ")})`);
}

async function download(): Promise<Buffer> {
  const response = await fetch(SOURCE_URL);
  if (!response.ok) throw new Error(`Could not download ${SOURCE_URL}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function verified(bytes: Buffer, label: string): Buffer {
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== SOURCE_SHA256) {
    throw new Error(
      `${label} is not the pinned Natural Earth file: expected sha256 ${SOURCE_SHA256}, got ${actual}.`
    );
  }
  return bytes;
}

async function main(): Promise<void> {
  const input = parseInput(process.argv.slice(2));
  const bytes = input === null ? await download() : readFileSync(input);
  const parsed = JSON.parse(verified(bytes, input ?? SOURCE_URL).toString("utf8")) as {
    features?: CubaFeature[];
  };
  if (!Array.isArray(parsed.features))
    throw new Error("The source is not a GeoJSON FeatureCollection.");

  const data = buildCubaModuleData(selectProvinces(parsed.features));
  const text = renderCubaModule(data);
  writeFileSync(OUTPUT, text);

  const points =
    data.coasts.reduce((total, ring) => total + ring.length, 0) +
    data.borders.reduce((total, arc) => total + arc.length, 0) +
    data.provinces.length;
  console.log(
    `wrote plugins/maibuk-maps/cuba.ts (${Buffer.byteLength(text)} bytes, ${points} points)`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
