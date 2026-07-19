/** A list row targeted by a file drag, and which side of it to insert on. */
export interface ListDropTarget {
  id: string;
  placement: "before" | "after";
}

/**
 * Resolves which list row a pointer at `clientY` targets. Rows are the
 * elements matching `selector` inside `container`; the row id is read from
 * `idAttribute`. Inside a row, the midpoint decides before/after; outside all
 * rows, the vertically nearest row is used.
 */
export function dropTargetFromPoint(
  container: HTMLElement,
  clientY: number,
  selector: string,
  idAttribute: string,
): ListDropTarget | null {
  const rows = Array.from(container.querySelectorAll<HTMLElement>(selector));
  let nearest: HTMLElement | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const row of rows) {
    const rect = row.getBoundingClientRect();
    if (clientY >= rect.top && clientY <= rect.bottom) {
      const id = row.getAttribute(idAttribute);
      if (!id) continue;
      return {
        id,
        placement: clientY < rect.top + rect.height / 2 ? "before" : "after",
      };
    }
    const distance =
      clientY < rect.top ? rect.top - clientY : clientY - rect.bottom;
    if (distance < nearestDistance && row.getAttribute(idAttribute)) {
      nearestDistance = distance;
      nearest = row;
    }
  }

  if (!nearest) return null;
  const id = nearest.getAttribute(idAttribute) as string;
  return {
    id,
    placement:
      clientY < nearest.getBoundingClientRect().top ? "before" : "after",
  };
}
