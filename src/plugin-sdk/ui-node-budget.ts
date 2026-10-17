/**
 * The Plugin-side node budget (#516, decision 2a), per mount. The host checks
 * `PLUGIN_UI_NODE_LIMIT` per mount: one shadow tree per receiver (validate.ts).
 * This budget is the same measure, taken where each node is made, so the render
 * stops before the rest of the tree is built on the QuickJS engine.
 *
 * What counts. The host's shadow counts every node it replays: elements and text
 * nodes (validate.ts `checkSerialization`: an element adds one, and so does each
 * text or comment node). So the Plugin counts elements (the UI kit's constructor)
 * and text nodes (the polyfilled `document.createTextNode`, hooked by
 * `worker-ui.tsx`). Comments are never made by the kit.
 *
 * Attribution. Nodes count against the mount that is rendering when they are
 * made: `renderingWithin(budget, ...)` runs a mount's first render, and the
 * mount renders synchronously (`flushSync`), so every node made in that render is
 * that mount's. Re-renders after the first are not attributed: React schedules
 * them, and this module cannot tell which mount they belong to. The host's
 * per-mount check still sees every update's mutations; only the early trip is
 * limited to the initial render. Documented, not papered over.
 *
 * Release. A removal record releases the nodes it takes out of the mount's
 * attached tree (`createRemovalWatch`). Nodes made and never attached (React
 * discarding work-in-progress) are never released; they count until the mount is
 * disposed, which bounds the drift to one mount's life.
 *
 * Only a Plugin Worker counts: `worker-ui.tsx` enables the count.
 */

import {
  MUTATION_TYPE_INSERT_CHILD,
  MUTATION_TYPE_REMOVE_CHILD,
  type RemoteMutationRecord,
  type RemoteNodeSerialization,
} from "@remote-dom/core";
import { PLUGIN_UI_NODE_LIMIT } from "@/plugin-sdk/ui-node-limit";

let enabled = false;
let active: MountBudget | null = null;
let onLimit: (() => void) | null = null;

/** One mount's count against the limit. */
export class MountBudget {
  #live = 0;
  #reported = false;
  #disposed = false;

  /** Nodes this mount holds live: made, less released. */
  get live(): number {
    return this.#live;
  }

  /** Counts one node made for this mount; reports the limit once, at limit + 1. */
  add(): void {
    if (this.#disposed) return;
    this.#live += 1;
    if (this.#live > PLUGIN_UI_NODE_LIMIT && !this.#reported) {
      this.#reported = true;
      onLimit?.();
    }
  }

  /** Releases nodes a removal took out of the mount's attached tree. */
  release(count: number): void {
    this.#live = Math.max(0, this.#live - count);
  }

  /** Stops counting for this mount, on unmount. Its nodes no longer count. */
  dispose(): void {
    this.#disposed = true;
    this.#live = 0;
  }
}

/** A new mount's budget, live at zero. */
export function createMountBudget(): MountBudget {
  return new MountBudget();
}

/** Turns the count on. Only the Plugin Worker entry calls this. */
export function enableRemoteElementCount(): void {
  enabled = true;
}

/** Turns the count off again (tests). */
export function disableRemoteElementCount(): void {
  enabled = false;
}

/**
 * Registers what happens when a mount passes the limit. The Worker entry posts
 * the limit's error through its own scope. Nothing here throws: a throw from a
 * custom element constructor is swallowed by the element machinery.
 */
export function setRemoteElementLimitHandler(handler: (() => void) | null): void {
  onLimit = handler;
}

/**
 * Runs `render` with `budget` as the mount that owns every node made inside it.
 * The mount's first render is the only one attributed (see the module comment).
 */
export function renderingWithin<T>(budget: MountBudget, render: () => T): T {
  const previous = active;
  active = budget;
  try {
    return render();
  } finally {
    active = previous;
  }
}

/**
 * Counts one node the Plugin made (a UI kit element, or a text node). Counts only
 * inside a Plugin Worker, and only for the mount rendering it.
 */
export function countRemoteNode(): void {
  if (!enabled || active === null) return;
  active.add();
}

/**
 * A per-mount mirror of the attached tree, so a removal record says how many
 * nodes it takes out of this mount's count. It reads the records the connection
 * already carries, with the host's shape: an insert carries its whole serialized
 * subtree; a remove names a parent and an index.
 */
export interface RemovalWatch {
  /** Observes one batch in order, releasing each removal's nodes from `budget`. */
  observe(records: readonly RemoteMutationRecord[]): void;
}

export function createRemovalWatch(budget: MountBudget): RemovalWatch {
  const children = new Map<string, string[]>();

  function index(serialization: RemoteNodeSerialization): void {
    const ids: string[] = [];
    children.set(serialization.id, ids);
    if ("children" in serialization && Array.isArray(serialization.children)) {
      for (const child of serialization.children) {
        ids.push(child.id);
        index(child);
      }
    }
  }

  /** Forgets a removed subtree and returns how many nodes it held. */
  function forget(id: string): number {
    let count = 1;
    for (const child of children.get(id) ?? []) count += forget(child);
    children.delete(id);
    return count;
  }

  return {
    observe(records) {
      for (const record of records) {
        if (record[0] === MUTATION_TYPE_INSERT_CHILD) {
          const parentId = record[1];
          const serialization = record[2];
          const at = record[3];
          const siblings = children.get(parentId) ?? [];
          children.set(parentId, siblings);
          index(serialization);
          const position = Math.max(0, Math.min(at ?? siblings.length, siblings.length));
          siblings.splice(position, 0, serialization.id);
        } else if (record[0] === MUTATION_TYPE_REMOVE_CHILD) {
          const siblings = children.get(record[1]);
          const childId = siblings?.[record[2]];
          if (siblings !== undefined && childId !== undefined) {
            siblings.splice(record[2], 1);
            budget.release(forget(childId));
          }
        }
      }
    },
  };
}
