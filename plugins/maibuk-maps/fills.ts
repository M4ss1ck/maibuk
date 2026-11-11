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
 * outside every face leaves the Elements exactly as they were.
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
    (element) => isFill(element) && faceAt(faces, element.anchor) === face
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
 * An edit that leaves every Fill where it was returns `after` itself, with each
 * unchanged Fill object kept, so history and autosave see no phantom edit.
 */
export function reconcileFills(before: MapElement[], after: MapElement[]): MapElement[] {
  if (!before.some(isFill) && !after.some(isFill)) return after;

  const facesBefore = findFaces(linesOf(before));
  const facesAfter = findFaces(linesOf(after));
  const beforeFills = before.filter(isFill).map((fill) => ({
    fill,
    face: faceAt(facesBefore, fill.anchor),
  }));

  // Follow each Fill to the after-face its anchor lies in; a Fill whose anchor
  // lies in no after-face is left out, which removes it.
  const moves: FillMove[] = [];
  for (const element of after) {
    if (!isFill(element)) continue;
    const afterFace = faceAt(facesAfter, element.anchor);
    if (afterFace === null) continue;
    moves.push({ fill: element, beforeFace: faceAt(facesBefore, element.anchor), afterFace });
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

  let changed = false;
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
    if (!isFill(element)) {
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

  return changed ? result : after;
}
