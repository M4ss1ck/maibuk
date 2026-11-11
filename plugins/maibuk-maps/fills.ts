/**
 * The Maps Fills (#748): pouring one colour into a face, and keeping every Fill
 * on its face after the author edits the Map Lines around it. A Fill holds an
 * anchor, and every edit moves that anchor to the deepest point of the face it
 * lands in, so a Fill follows a border that moves and never jumps into a
 * neighbour. A face that splits gives every half a copy; two faces that merge
 * keep the larger face's Fill.
 *
 * Pure functions over Elements and page millimetres. This module imports only
 * `./maps` and `./faces`.
 */

import { deepestPoint, faceAt, findFaces, type Face } from "./faces";
import type { MapElement, MapFillElement, MapLineElement, MapPoint } from "./maps";

/** Builds a Fill at `anchor` in `color`; the caller owns its id and name. */
export type MakeFill = (anchor: MapPoint, color: string) => MapFillElement;

/** The Element kinds a new Fill is drawn behind: a Fill sits under all of them. */
const KINDS_DRAWN_OVER_A_FILL: ReadonlySet<string> = new Set(["line", "stamp", "label"]);

function isFill(element: MapElement): element is MapFillElement {
  return element.kind === "fill";
}

/** Whether a Fill covers its own outline (#750), so no face decides where it sits. */
function isAreaFill(fill: MapFillElement): boolean {
  return fill.outline !== undefined;
}

/** The Map Lines of an elements array, which are what faces are built from. */
function linesOf(elements: readonly MapElement[]): MapLineElement[] {
  return elements.filter((element): element is MapLineElement => element.kind === "line");
}

/** Where a new Fill goes: in front of every image and older Fill, behind a line, stamp, or label. */
function insertionIndex(elements: readonly MapElement[]): number {
  const index = elements.findIndex((element) => KINDS_DRAWN_OVER_A_FILL.has(element.kind));
  return index === -1 ? elements.length : index;
}

/**
 * Pours `color` into the face `point` falls in. The Fill already in that face
 * takes the new colour and keeps its place; otherwise a new Fill appears at the
 * face's deepest point, behind every Map Line, Stamp, and Map Label. A point
 * outside every face leaves the Elements exactly as they were. An Area Fill
 * covers its own outline, so a pour never recolours one.
 */
export function pourFill(
  elements: MapElement[],
  point: MapPoint,
  color: string,
  makeFill: MakeFill
): MapElement[] {
  const faces = findFaces(linesOf(elements));
  const face = faceAt(faces, point);
  if (face === null) return elements;

  const existing = elements.findIndex(
    (element) => isFill(element) && !isAreaFill(element) && faceAt(faces, element.anchor) === face
  );
  if (existing !== -1) {
    // A locked Fill refuses the Bucket as it refuses the colour control.
    const current = elements[existing];
    // A colour the Fill already has is no edit either, so it is no undo step.
    if (current.locked || (current.kind === "fill" && current.content.color === color)) {
      return elements;
    }
    return elements.map((element, index) =>
      index === existing && isFill(element)
        ? { ...element, content: { ...element.content, color } }
        : element
    );
  }

  const fill = makeFill(deepestPoint(face), color);
  const at = insertionIndex(elements);
  return [...elements.slice(0, at), fill, ...elements.slice(at)];
}

/** One Fill of the after array, with the face it left and the face it lands in. */
interface FillMove {
  fill: MapFillElement;
  beforeFace: Face | null;
  afterFace: Face;
}

/** One copy the Split rule adds, and the Fill it was copied from. */
interface FillCopy {
  originalId: string;
  fill: MapFillElement;
}

function samePoint(a: MapPoint, b: MapPoint): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/**
 * How far apart two ring corners may be and still be the same corner, in mm.
 * Faces are built from paths written to the hundredth of a millimetre
 * (`linePath`), so a corner moved by any offset lands up to a hundredth away
 * from the shifted old corner; twice that leaves room for a curve's samples,
 * and is still far below any gap an author could draw.
 */
const RING_TOLERANCE_MM = 0.02;

/**
 * Whether two rings run through the same corners once `ring` is shifted by
 * `dx`, `dy`. Polygonize may start a ring at any corner and run it either way,
 * so the corners are compared as a set; rings are closed, so the repeated
 * last corner is left out.
 */
function sameRing(ring: readonly MapPoint[], other: readonly MapPoint[], dx = 0, dy = 0): boolean {
  if (ring.length !== other.length) return false;
  const corners = other.slice(0, -1);
  return ring
    .slice(0, -1)
    .every(([x, y]) =>
      corners.some(
        ([ox, oy]) =>
          Math.abs(x + dx - ox) <= RING_TOLERANCE_MM && Math.abs(y + dy - oy) <= RING_TOLERANCE_MM
      )
    );
}

/** The offset one move shifted Map Lines by, in page millimetres. */
export interface FillTranslation {
  dx: number;
  dy: number;
}

/**
 * Where a Fill's anchor goes before the anchor rule runs, after a move of
 * Map Lines by `offset`. A move can carry a closed line further than its own
 * size, and then the old anchor lies outside the face it came from, so the
 * anchor alone cannot tell where the Fill went:
 *
 * - A face that moved whole, its outer ring shifted by the offset, takes the
 *   Fill with it: the anchor shifts by the same offset.
 * - A face whose outer ring stayed put, though a hole in it moved (a lake
 *   dragged across the land), keeps the Fill: the anchor goes to the deepest
 *   point of that face as it is now, which no moved hole covers.
 * - Any other face changed shape, a border between two provinces moved, and
 *   the anchor stays for the usual rule, exactly as without the offset.
 */
function followMove(
  anchor: MapPoint,
  facesBefore: readonly Face[],
  facesAfter: readonly Face[],
  offset: FillTranslation
): MapPoint {
  const face = faceAt(facesBefore, anchor);
  if (face === null) return anchor;
  const { dx, dy } = offset;
  const moved = facesAfter.find(
    (after) => after.holes.length === face.holes.length && sameRing(face.outer, after.outer, dx, dy)
  );
  if (moved !== undefined) return [anchor[0] + dx, anchor[1] + dy];
  const stayed = facesAfter.find((after) => sameRing(face.outer, after.outer));
  if (stayed !== undefined && faceAt(facesAfter, anchor) !== stayed) return deepestPoint(stayed);
  return anchor;
}

/** A face's area, with a Fill that had no before-face losing every merge. */
function areaOf(face: Face | null): number {
  return face === null ? -1 : face.area;
}

/** The smallest copy id of `originalId` not already in use, `n` from 2. */
function copyId(originalId: string, used: Set<string>): string {
  let n = 2;
  while (used.has(`${originalId}-${n}`)) n++;
  const id = `${originalId}-${n}`;
  used.add(id);
  return id;
}

/**
 * Keeps every Fill on its face after an edit, given the Elements before and
 * after it. Each Fill follows its new face to that face's deepest point, two
 * Fills merged into one face leave the larger face's Fill, a face a new line
 * splits gives each half a copy, and a Fill whose face disappears is removed.
 * An Area Fill covers its own outline, so the face rules leave it exactly where
 * it is. An edit that leaves every Fill where it was returns `edited` itself,
 * with each unchanged Fill object kept, so history and autosave see no phantom
 * edit.
 *
 * `offset` is the shift of an edit that only moved one Map Line (an arrow move
 * or a Select drag, #766). With it, a Fill whose face moved whole goes with
 * it however far it went, and one whose face only lost a moved hole stays on
 * that face (`followMove`).
 */
export function reconcileFills(
  before: MapElement[],
  edited: MapElement[],
  offset?: FillTranslation
): MapElement[] {
  if (!before.some(isFill) && !edited.some(isFill)) return edited;

  const facesBefore = findFaces(linesOf(before));
  const facesAfter = findFaces(linesOf(edited));
  const beforeFills = before
    .filter(isFill)
    .filter((fill) => !isAreaFill(fill))
    .map((fill) => ({
      fill,
      face: faceAt(facesBefore, fill.anchor),
    }));
  // The face each Fill held before the edit, by id: a moved anchor no longer
  // points into it, and the merge rule weighs the face the Fill came from.
  const beforeFaces = new Map(beforeFills.map((entry) => [entry.fill.id, entry.face]));

  let after = edited;
  if (offset !== undefined) {
    let carried = false;
    const next = edited.map((element) => {
      if (!isFill(element) || isAreaFill(element)) return element;
      const anchor = followMove(element.anchor, facesBefore, facesAfter, offset);
      if (samePoint(anchor, element.anchor)) return element;
      carried = true;
      return { ...element, anchor };
    });
    if (carried) after = next;
  }

  // Follow each Fill to the after-face its anchor lies in; a Fill whose anchor
  // lies in no after-face is left out, which removes it. An Area Fill answers to
  // its own outline, so it is never left out.
  const moves: FillMove[] = [];
  for (const element of after) {
    if (!isFill(element) || isAreaFill(element)) continue;
    const afterFace = faceAt(facesAfter, element.anchor);
    if (afterFace === null) continue;
    const beforeFace = beforeFaces.has(element.id)
      ? (beforeFaces.get(element.id) ?? null)
      : faceAt(facesBefore, element.anchor);
    moves.push({ fill: element, beforeFace, afterFace });
  }

  // Merge: one after-face keeps the one Fill whose before-face was the larger.
  const winners = new Map<Face, FillMove>();
  for (const move of moves) {
    const current = winners.get(move.afterFace);
    if (current === undefined || areaOf(move.beforeFace) > areaOf(current.beforeFace)) {
      winners.set(move.afterFace, move);
    }
  }
  const kept = moves.filter((move) => winners.get(move.afterFace) === move);
  const keptFills = new Set(kept.map((move) => move.fill));

  let changed = after !== edited;
  const anchors = new Map<string, MapPoint>();
  for (const move of kept) {
    const anchor = deepestPoint(move.afterFace);
    if (!samePoint(anchor, move.fill.anchor)) {
      anchors.set(move.fill.id, anchor);
      changed = true;
    }
  }

  const result: MapElement[] = [];
  for (const element of after) {
    if (!isFill(element) || isAreaFill(element)) {
      result.push(element);
      continue;
    }
    if (!keptFills.has(element)) {
      changed = true;
      continue;
    }
    const anchor = anchors.get(element.id);
    result.push(anchor === undefined ? element : { ...element, anchor });
  }

  // Split: an after-face with no Fill whose deepest point lies inside a
  // before-face that held a Fill gets a copy of that Fill, after the original.
  const filled = new Set(kept.map((move) => move.afterFace));
  const usedIds = new Set(result.map((element) => element.id));
  const copies: FillCopy[] = [];
  for (const face of facesAfter) {
    if (filled.has(face)) continue;
    const point = deepestPoint(face);
    const beforeFace = faceAt(facesBefore, point);
    if (beforeFace === null) continue;
    // Only a Fill the edit kept is copied: one the author just deleted must
    // not come back as a copy of itself.
    const original = beforeFills.find(
      (entry) => entry.face === beforeFace && usedIds.has(entry.fill.id)
    );
    if (original === undefined) continue;
    copies.push({
      originalId: original.fill.id,
      fill: { ...original.fill, id: copyId(original.fill.id, usedIds), anchor: point },
    });
  }

  const inserted = new Map<string, number>();
  for (const copy of copies) {
    changed = true;
    const originalIndex = result.findIndex((element) => element.id === copy.originalId);
    const at = inserted.has(copy.originalId)
      ? (inserted.get(copy.originalId) as number) + 1
      : originalIndex === -1
        ? result.length
        : originalIndex + 1;
    result.splice(at, 0, copy.fill);
    inserted.set(copy.originalId, at);
  }

  return changed ? result : edited;
}
