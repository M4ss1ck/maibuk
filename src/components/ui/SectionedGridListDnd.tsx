import { createContext, useContext, useMemo } from "react";
import type { ReactNode, RefObject } from "react";
import { CollectionRendererContext } from "react-aria-components";
import type { CollectionRenderer, DropTarget } from "react-aria-components";
import type { useDragAndDrop } from "react-aria-components/useDragAndDrop";

// Drag-and-drop for a GridList split into GridListSections. React Aria
// (react-aria-components 1.19 through 1.21) assumes a flat list in two places,
// and both break once rows sit inside sections:
// - drop indicators are handed to the root's rows only, so section rows get
//   none and a keyboard drag has nowhere to land (SectionDropIndicators);
// - its default drop-target delegate walks top-level nodes only, finds the
//   sections instead of rows, and sends every pointer drop to the root
//   (SectionedDropTargetDelegate).

type RenderDropIndicator = CollectionRenderer extends {
  CollectionRoot: React.ComponentType<infer P>;
}
  ? P extends { renderDropIndicator?: infer R }
    ? R
    : never
  : never;

const RootDropIndicatorContext = createContext<RenderDropIndicator | undefined>(undefined);

/**
 * Wraps a renderer so the root's drop indicators reach every section. It builds
 * on the renderer in context, so it can sit inside a Virtualizer (whose own
 * renderer would otherwise replace this one) as well as at the top of a plain
 * GridList.
 */
function sectionAwareRendererOver(base: CollectionRenderer): CollectionRenderer {
  const BaseRoot = base.CollectionRoot;
  const BaseBranch = base.CollectionBranch;
  return {
    ...base,
    CollectionRoot: function SectionAwareCollectionRoot(props) {
      return (
        <RootDropIndicatorContext.Provider value={props.renderDropIndicator}>
          <BaseRoot {...props} />
        </RootDropIndicatorContext.Provider>
      );
    },
    CollectionBranch: function SectionAwareCollectionBranch(props) {
      const inherited = useContext(RootDropIndicatorContext);
      return <BaseBranch {...props} renderDropIndicator={props.renderDropIndicator ?? inherited} />;
    },
  };
}

/**
 * Wrap a sectioned GridList that uses drag-and-drop so its section rows get drop targets.
 * Inside a Virtualizer, place it between the Virtualizer and the GridList.
 */
export function SectionDropIndicators({ children }: { children: ReactNode }) {
  const base = useContext(CollectionRendererContext);
  const renderer = useMemo(() => sectionAwareRendererOver(base), [base]);
  return (
    <CollectionRendererContext.Provider value={renderer}>
      {children}
    </CollectionRendererContext.Provider>
  );
}

type DropTargetDelegate = NonNullable<Parameters<typeof useDragAndDrop>[0]["dropTargetDelegate"]>;

/**
 * Pointer drop targets from the mounted rows, in screen order, whatever
 * section they sit in: the gap before the first row whose middle is below the
 * pointer, else after the last row. Drops *on* a row are never offered.
 */
export class SectionedDropTargetDelegate implements DropTargetDelegate {
  constructor(private readonly gridRef: RefObject<HTMLElement | null>) {}

  getDropTargetFromPoint(
    _x: number,
    y: number,
    isValidDropTarget: (target: DropTarget) => boolean
  ): DropTarget {
    const grid = this.gridRef.current;
    if (!grid) return { type: "root" };
    // Only this grid's rows; drop indicators and section headers carry no key.
    // A Virtualizer appends rows in an order that is not their visual order, and
    // only the rows near the viewport are mounted, so the rows are ordered by
    // where they sit on screen rather than by DOM position.
    const rows = [...grid.querySelectorAll<HTMLElement>('[role="row"][data-key]')]
      .filter((row) => row.closest('[role="grid"]') === grid)
      .map((row) => ({ row, top: row.getBoundingClientRect().top }))
      .sort((a, b) => a.top - b.top)
      .map(({ row }) => row);
    if (rows.length === 0) return { type: "root" };

    // React Aria passes the point relative to the collection element.
    const clientY = y + grid.getBoundingClientRect().top;
    const candidates: DropTarget[] = [];
    const index = rows.findIndex((row) => {
      const rect = row.getBoundingClientRect();
      return clientY < rect.top + rect.height / 2;
    });
    if (index === -1) {
      candidates.push({
        type: "item",
        key: rows[rows.length - 1].dataset.key!,
        dropPosition: "after",
      });
    } else {
      candidates.push({ type: "item", key: rows[index].dataset.key!, dropPosition: "before" });
      if (index > 0) {
        candidates.push({ type: "item", key: rows[index - 1].dataset.key!, dropPosition: "after" });
      }
    }
    return candidates.find(isValidDropTarget) ?? { type: "root" };
  }
}
