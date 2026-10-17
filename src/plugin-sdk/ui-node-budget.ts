/**
 * The Plugin-side node budget (#516, decision 2a). The host stops a Plugin whose
 * interface holds more than `PLUGIN_UI_LIMITS.maxNodes` elements, but only after
 * the records reach it. On the Android QuickJS engine a 12,000-node render takes
 * longer than the Worker's heartbeat, so the host would see the Plugin go silent
 * before it saw the overflow. This budget counts live nodes from the same records
 * the host replays, with the host's rules (`validate.ts`: an insert adds its
 * whole serialized subtree, a remove takes its subtree away, the receiver root is
 * not a Plugin node), so the Plugin knows it is over the limit when the mutation
 * is made. It never replaces the host's check; the host stays authoritative.
 */

import {
  MUTATION_TYPE_INSERT_CHILD,
  MUTATION_TYPE_REMOVE_CHILD,
  type RemoteMutationRecord,
  type RemoteNodeSerialization,
} from "@remote-dom/core";

export interface PluginNodeBudget {
  /**
   * Applies one batch of records to the mirror, in order. Returns `true` while
   * the live tree is within `maxNodes`, and `false` from the first record that
   * takes it over (and on every later call, since the tree stays over).
   */
  apply(records: readonly RemoteMutationRecord[]): boolean;
  /** The live Plugin node count the mirror holds. */
  readonly nodes: number;
}

/** A mirror of the Plugin-side tree that counts its live elements and text nodes. */
export function createPluginNodeBudget(maxNodes: number): PluginNodeBudget {
  const children = new Map<string, string[]>();
  let nodes = 0;
  let over = false;

  function insertSubtree(serialization: RemoteNodeSerialization): void {
    nodes += 1;
    const ids: string[] = [];
    children.set(serialization.id, ids);
    if ("children" in serialization && Array.isArray(serialization.children)) {
      for (const child of serialization.children) {
        ids.push(child.id);
        insertSubtree(child);
      }
    }
  }

  function removeSubtree(id: string): void {
    for (const child of children.get(id) ?? []) removeSubtree(child);
    children.delete(id);
    nodes -= 1;
  }

  function applyRecord(record: RemoteMutationRecord): void {
    if (record[0] === MUTATION_TYPE_INSERT_CHILD) {
      const parentId = record[1];
      const serialization = record[2];
      const index = record[3];
      const siblings = children.get(parentId) ?? [];
      children.set(parentId, siblings);
      insertSubtree(serialization);
      const at = Math.max(0, Math.min(index ?? siblings.length, siblings.length));
      siblings.splice(at, 0, serialization.id);
      return;
    }
    if (record[0] === MUTATION_TYPE_REMOVE_CHILD) {
      const siblings = children.get(record[1]);
      const childId = siblings?.[record[2]];
      if (siblings !== undefined && childId !== undefined) {
        siblings.splice(record[2], 1);
        removeSubtree(childId);
      }
    }
  }

  return {
    apply(records) {
      if (over) return false;
      for (const record of records) {
        applyRecord(record);
        if (nodes > maxNodes) {
          over = true;
          return false;
        }
      }
      return true;
    },
    get nodes() {
      return nodes;
    },
  };
}
