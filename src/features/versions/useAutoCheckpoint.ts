import { useRef, useEffect } from "react";
import { useVersionStore } from "./store";
import {
  VERSION_CHECKPOINT_WORD_THRESHOLD,
  VERSION_CHECKPOINT_IDLE_MS,
  VERSION_CHECKPOINT_MIN_INTERVAL_MS,
} from "../../constants";

export function useAutoCheckpoint(params: {
  bookId: string | undefined;
  wordCount: number;
  enabled?: boolean;
}): void {
  const { bookId, wordCount, enabled = true } = params;
  const lastCheckpointWordCount = useRef<number>(0);
  const lastCheckpointAt = useRef<number>(0);
  const baselineInitialized = useRef<boolean>(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset baseline when the active book changes — wordCount jumps that come
  // from switching books, or from chapters loading asynchronously after mount,
  // must not be counted as user edits.
  useEffect(() => {
    baselineInitialized.current = false;
    lastCheckpointAt.current = 0;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, [bookId]);

  useEffect(() => {
    if (!enabled || !bookId) return;

    // Anchor the baseline at the first non-zero wordCount we see for this book.
    // This treats the initial chapters-load (0 → N) as the starting point, not as an edit.
    if (!baselineInitialized.current) {
      if (wordCount > 0) {
        lastCheckpointWordCount.current = wordCount;
        baselineInitialized.current = true;
      }
      return;
    }

    const delta = Math.abs(wordCount - lastCheckpointWordCount.current);
    const now = Date.now();

    if (
      delta >= VERSION_CHECKPOINT_WORD_THRESHOLD &&
      now - lastCheckpointAt.current >= VERSION_CHECKPOINT_MIN_INTERVAL_MS
    ) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      timerRef.current = setTimeout(async () => {
        const created = await useVersionStore
          .getState()
          .createVersion({ bookId, triggerType: "auto-idle" });

        if (created) {
          lastCheckpointWordCount.current = wordCount;
          lastCheckpointAt.current = Date.now();
        }

        timerRef.current = null;
      }, VERSION_CHECKPOINT_IDLE_MS);
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [wordCount, bookId, enabled]);
}
