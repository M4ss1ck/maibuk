// Dependency-free signal that the user changed synced data (books, chapters,
// notes). Stores call notifyLocalChange from their mutation actions; automatic
// sync listens. Kept import-free so data stores do not pull the sync stack in.
// Sync pulls write through the serializer, not these actions, so applying a
// remote change never signals a local one.

type Listener = () => void;

const listeners = new Set<Listener>();

export function notifyLocalChange(): void {
  for (const listener of listeners) listener();
}

export function onLocalChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
