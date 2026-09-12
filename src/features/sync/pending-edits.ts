// Editors hold keystrokes in a debounced save for about a second. Before an
// automatic sync reads the database, and again right before it applies a pulled
// change, those pending saves must land; otherwise the pull would replace text
// that never reached the database. Editors register a flush while mounted.

type Flush = () => unknown;

const flushes = new Set<Flush>();

export function registerPendingEditsFlush(flush: Flush): () => void {
  flushes.add(flush);
  return () => {
    flushes.delete(flush);
  };
}

/** Run every registered flush and wait for the saves; a failed save does not block the rest. */
export async function flushPendingEdits(): Promise<void> {
  await Promise.allSettled([...flushes].map(async (flush) => flush()));
}
