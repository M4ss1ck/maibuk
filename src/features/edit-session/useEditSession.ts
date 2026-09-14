import { useEffect, useRef, useState, type RefObject } from "react";
import type { AsyncQueue } from "@/lib/async-queue";
import { registerPendingEditsFlush } from "@/features/sync/pending-edits";
import {
  createEditSession,
  type EditSession,
  type EditSessionStatus,
} from "@/features/edit-session/create-edit-session";

export interface UseEditSessionOptions<T> {
  /** One Edit Session per key: opening another Chapter or Note closes the old one. */
  sessionKey: string;
  /** The item's content as the store holds it right now. */
  content: T;
  /** Writes the content for `sessionKey` and resolves with it as stored. */
  save: (content: T, sessionKey: string) => Promise<T>;
  /** Hands over input the editor still holds, synchronously. */
  beforeFlush?: () => void;
  /** Must be stable; shares ordering with the item's other writes. */
  queue?: AsyncQueue;
}

export interface UseEditSessionResult<T> {
  /** The open Edit Session. Read it at event time; it changes with `sessionKey`. */
  sessionRef: RefObject<EditSession<T> | null>;
  status: EditSessionStatus;
  /** What the editor shows: the content it opened with, or an outside change since. */
  editorContent: T;
}

const ignore = () => {};

export function useEditSession<T>({
  sessionKey,
  content,
  save,
  beforeFlush,
  queue,
}: UseEditSessionOptions<T>): UseEditSessionResult<T> {
  const sessionRef = useRef<EditSession<T> | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;
  const beforeFlushRef = useRef(beforeFlush);
  beforeFlushRef.current = beforeFlush;
  const contentRef = useRef(content);
  contentRef.current = content;

  const [status, setStatus] = useState<EditSessionStatus>("idle");
  const [shown, setShown] = useState({ key: sessionKey, content });
  if (shown.key !== sessionKey) setShown({ key: sessionKey, content });

  useEffect(() => {
    const key = sessionKey;
    const session = createEditSession<T>({
      initial: contentRef.current,
      save: (next) => saveRef.current(next, key),
      beforeFlush: () => beforeFlushRef.current?.(),
      onExternal: (next) => setShown({ key, content: next }),
      queue,
    });
    // Left pointing at this session after it closes: the editor hands over its
    // last keystrokes while unmounting, and they belong to this session.
    sessionRef.current = session;
    setStatus(session.getStatus());
    const stopStatus = session.subscribe(setStatus);

    // A closed session stays registered until its text is saved, so a close
    // whose save failed is retried by the next Flush instead of forgotten.
    const unregister = registerPendingEditsFlush(() => session.flush());
    const releaseIfSaved = () => {
      if (!session.isDisposed() || session.hasUnsavedChanges()) return;
      if (session.getStatus() === "saving") return;
      unregister();
      stopRelease();
    };
    const stopRelease = session.subscribe(releaseIfSaved);

    return () => {
      stopStatus();
      session.dispose().then(releaseIfSaved, ignore);
    };
  }, [sessionKey, queue]);

  useEffect(() => {
    sessionRef.current?.externalContent(content);
  }, [content]);

  return {
    sessionRef,
    status,
    editorContent: shown.key === sessionKey ? shown.content : content,
  };
}
