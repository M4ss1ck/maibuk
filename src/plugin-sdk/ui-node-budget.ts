/**
 * The Plugin-side element counter (#516, decision 2a). The host stops a Plugin
 * whose interface holds more than `PLUGIN_UI_NODE_LIMIT` elements, but on the
 * Android QuickJS engine a 12,000-element render blocks the Worker long before
 * any mutation reaches the host: React builds a new subtree detached and inserts
 * it in one record at the end. So the count runs where each element is made.
 *
 * The count is live elements: every UI kit element adds one when it is
 * constructed, and every element a removal record takes out of a mount's tree
 * subtracts one. It runs only inside a Plugin Worker (`worker-ui.tsx` enables
 * it), so the host's own tests and renderer never count. At the limit's
 * (limit + 1)th live element the constructor throws `PLUGIN_UI_NODE_LIMIT_MARKER`.
 *
 * Known over-count: React's concurrent renderer can discard work-in-progress
 * elements that were constructed but never attached. Nothing removes them, so
 * the count runs high for each discarded tree. The counter resets when every
 * mount is torn down, which bounds the drift to one Plugin session's renders.
 * The host's check, which counts the attached tree, stays authoritative.
 */

import {
  MUTATION_TYPE_INSERT_CHILD,
  MUTATION_TYPE_REMOVE_CHILD,
  NODE_TYPE_ELEMENT,
  type RemoteMutationRecord,
  type RemoteNodeSerialization,
} from "@remote-dom/core";
import {
  PLUGIN_UI_NODE_LIMIT,
  PLUGIN_UI_NODE_LIMIT_MARKER,
} from "@/plugin-sdk/ui-node-limit";

let enabled = false;
let live = 0;

/** Turns the counter on. Only the Plugin Worker entry calls this. */
export function enableRemoteElementCount(): void {
  enabled = true;
}

/** Turns the counter off again (tests, and a Worker that never ran the entry). */
export function disableRemoteElementCount(): void {
  enabled = false;
}

/** The live element count. */
export function remoteElementCount(): number {
  return live;
}

/** Forgets every count; called when the last mount is torn down. */
export function resetRemoteElementCount(): void {
  live = 0;
}

/**
 * Counts one constructed UI kit element. Throws the limit marker at the
 * (limit + 1)th live element, before the render builds the rest of the tree.
 */
export function countRemoteElement(): void {
  if (!enabled) return;
  live += 1;
  if (live > PLUGIN_UI_NODE_LIMIT) throw new Error(PLUGIN_UI_NODE_LIMIT_MARKER);
}

function releaseElements(count: number): void {
  live = Math.max(0, live - count);
}

/**
 * A per-mount mirror of the attached tree's elements, so a removal record can
 * say how many live elements it takes away. It reads only the records the
 * connection already carries, with the host's shape: an insert carries the
 * whole serialized subtree, a remove names a parent and an index.
 */
export interface RemovalWatch {
  /** Observes one batch in order, releasing the elements each removal takes out. */
  observe(records: readonly RemoteMutationRecord[]): void;
}

export function createRemovalWatch(): RemovalWatch {
  const children = new Map<string, string[]>();
  const isElement = new Map<string, boolean>();

  function index(serialization: RemoteNodeSerialization): void {
    isElement.set(serialization.id, serialization.type === NODE_TYPE_ELEMENT);
    const ids: string[] = [];
    children.set(serialization.id, ids);
    if ("children" in serialization && Array.isArray(serialization.children)) {
      for (const child of serialization.children) {
        ids.push(child.id);
        index(child);
      }
    }
  }

  /** Forgets a removed subtree and returns how many elements it held. */
  function forget(id: string): number {
    let count = isElement.get(id) ? 1 : 0;
    for (const child of children.get(id) ?? []) count += forget(child);
    children.delete(id);
    isElement.delete(id);
    return count;
  }

  return {
    observe(records) {
      for (const record of records) {
        if (record[0] === MUTATION_TYPE_INSERT_CHILD) {
          const parentId = record[1];
          const serialization = record[2];
          const index_ = record[3];
          const siblings = children.get(parentId) ?? [];
          children.set(parentId, siblings);
          index(serialization);
          const at = Math.max(0, Math.min(index_ ?? siblings.length, siblings.length));
          siblings.splice(at, 0, serialization.id);
        } else if (record[0] === MUTATION_TYPE_REMOVE_CHILD) {
          const siblings = children.get(record[1]);
          const childId = siblings?.[record[2]];
          if (siblings !== undefined && childId !== undefined) {
            siblings.splice(record[2], 1);
            releaseElements(forget(childId));
          }
        }
      }
    },
  };
}
