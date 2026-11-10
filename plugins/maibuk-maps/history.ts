/**
 * Undo and redo for one open Map (#745), in memory. The history holds whole
 * snapshots of the Elements list, because every edit already produces a new
 * array; it never touches storage itself, so a reload starts a fresh history.
 *
 * `commit` ignores a save of the same array (nothing changed refers to the
 * same snapshot), drops the redo branch, and keeps at most the last 100
 * steps. This module imports only its own files.
 */

/** The most committed steps an open Map keeps. */
export const HISTORY_LIMIT = 100;

export interface History<T> {
  readonly current: T;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  commit(next: T): void;
  undo(): void;
  redo(): void;
}

export function createHistory<T>(initial: T): History<T> {
  let current = initial;
  const past: T[] = [];
  const future: T[] = [];

  return {
    get current() {
      return current;
    },
    get canUndo() {
      return past.length > 0;
    },
    get canRedo() {
      return future.length > 0;
    },
    commit(next) {
      if (next === current) return;
      past.push(current);
      if (past.length > HISTORY_LIMIT) past.shift();
      current = next;
      future.length = 0;
    },
    undo() {
      if (past.length === 0) return;
      const previous = past.pop() as T;
      future.unshift(current);
      current = previous;
    },
    redo() {
      if (future.length === 0) return;
      const next = future.shift() as T;
      past.push(current);
      if (past.length > HISTORY_LIMIT) past.shift();
      current = next;
    },
  };
}
