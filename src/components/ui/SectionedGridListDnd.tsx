import { createContext, useContext } from "react";
import type { ReactNode, RefObject } from "react";
import { CollectionRendererContext, DefaultCollectionRenderer } from "react-aria-components";
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

// Passes the root's drop indicators down to every section.
const sectionAwareRenderer: CollectionRenderer = {
  ...DefaultCollectionRenderer,
  CollectionRoot: function SectionAwareCollectionRoot(props) {
    return (
      <RootDropIndicatorContext.Provider value={props.renderDropIndicator}>
        <DefaultCollectionRenderer.CollectionRoot {...props} />
      </RootDropIndicatorContext.Provider>
    );
  },
  CollectionBranch: function SectionAwareCollectionBranch(props) {
    const inherited = useContext(RootDropIndicatorContext);
    return (
      <DefaultCollectionRenderer.CollectionBranch
        {...props}
        renderDropIndicator={props.renderDropIndicator ?? inherited}
      />
    );
  },
};

/** Wrap a sectioned GridList that uses drag-and-drop so its section rows get drop targets. */
export function SectionDropIndicators({ children }: { children: ReactNode }) {
  return (
    <CollectionRendererContext.Provider value={sectionAwareRenderer}>
      {children}
    </CollectionRendererContext.Provider>
  );
}

type DropTargetDelegate = NonNullable<Parameters<typeof useDragAndDrop>[0]["dropTargetDelegate"]>;

/**
 * Pointer drop targets from the rendered rows, in document order, whatever
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
    const rows = [...grid.querySelectorAll<HTMLElement>('[role="row"][data-key]')].filter(
      (row) => row.closest('[role="grid"]') === grid
    );
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
