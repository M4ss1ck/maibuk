/**
 * The live Connections the MCP Server page reads (#594): the snapshot the
 * runtime publishes when one opens, moves, or ends, and the subscriptions that
 * repaint the page. It sits apart from the runtime (`./plugin`) and the page
 * (`./connections-panel`) so neither has to import the other for this state.
 *
 * This module imports nothing, so both sides can read it without a cycle.
 */

/** One live Connection as Plugin storage holds it, in ms since the epoch. */
export interface ConnectionRecord {
  name: string;
  startedAt: number;
  lastActivityAt: number;
}

/** The live Connections the Plugin page in this Worker reads, sorted by name. */
let connectionSnapshot: readonly ConnectionRecord[] = [];

/** The page's re-renders, told whenever a Connection opens, moves, or ends. */
const connectionListeners = new Set<() => void>();

/** The live Connections, sorted by name; the array changes identity on a change. */
export function liveConnections(): readonly ConnectionRecord[] {
  return connectionSnapshot;
}

/** Calls `listener` whenever the live Connections change; returns the stopper. */
export function subscribeConnections(listener: () => void): () => void {
  connectionListeners.add(listener);
  return () => {
    connectionListeners.delete(listener);
  };
}

/** Publishes the live list to the page. */
export function publishConnections(records: readonly ConnectionRecord[]): void {
  connectionSnapshot = records;
  for (const listener of connectionListeners) listener();
}
