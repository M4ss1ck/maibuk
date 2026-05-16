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
  const lastCheckpointWordCount = useRef<number>(wordCount);
  const lastCheckpointAt = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initialize from first observed wordCount so initial load is not a change
  useEffect(() => {
    lastCheckpointWordCount.current = wordCount;
  }, []); // only on mount

  useEffect(() => {
    if (!enabled || !bookId) return;

    const delta = Math.abs(wordCount - lastCheckpointWordCount.current);
    const now = Date.now();

    if (
      delta >= VERSION_CHECKPOINT_WORD_THRESHOLD &&
      now - lastCheckpointAt.current >= VERSION_CHECKPOINT_MIN_INTERVAL_MS
    ) {
      // Clear any existing timer before re-arming
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
