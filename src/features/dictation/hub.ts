// Editors register synchronously, before the async dictation runtime exists;
// the hub keeps them and hands them to the session once it attaches.
import type {
  DictationSession,
  DictationTarget,
} from "@/features/dictation/session";

type AttachedSession = Pick<
  DictationSession,
  "register" | "focus" | "stop" | "getSnapshot"
>;

let session: AttachedSession | null = null;
const entries = new Map<
  string,
  { target: DictationTarget; unregister?: () => void }
>();
let lastFocus: string | null = null;

export const dictationHub = {
  register(target: DictationTarget): () => void {
    const entry: { target: DictationTarget; unregister?: () => void } = {
      target,
    };
    entries.set(target.id, entry);
    if (session) entry.unregister = session.register(target);
    return () => {
      entry.unregister?.();
      entries.delete(target.id);
      if (lastFocus === target.id) lastFocus = null;
    };
  },
  focus(targetId: string): void {
    lastFocus = targetId;
    session?.focus(targetId);
  },
  isListening(): boolean {
    const status = session?.getSnapshot().status;
    return status === "listening" || status === "loading";
  },
  stop(): void {
    void session?.stop();
  },
};

export function attachSession(next: AttachedSession): void {
  session = next;
  for (const entry of entries.values())
    entry.unregister = next.register(entry.target);
  if (lastFocus) next.focus(lastFocus);
}

export function resetDictationHubForTests(): void {
  session = null;
  entries.clear();
  lastFocus = null;
}
