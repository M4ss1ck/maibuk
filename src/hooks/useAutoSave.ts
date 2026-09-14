import { useRef, useEffect, useCallback, useMemo } from "react";

export type DebouncedCallback<T> = T & {
  /** Drop the pending call, if any, without running it. */
  cancel: () => void;
  /** Run the pending call now, if any, and return its result. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  flush: () => (T extends (...args: any[]) => infer R ? R : never) | undefined;
};

export interface DebounceOptions {
  /**
   * Run the pending call when the component unmounts instead of dropping it,
   * and run calls made after unmount right away. Saves use this so leaving an
   * editor never discards what the author typed.
   */
  flushOnUnmount?: boolean;
}

/**
 * A hook that debounces a callback function.
 * The callback will only be executed after the specified delay has passed
 * without any new calls.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useDebouncedCallback<T extends (...args: any[]) => any>(
  callback: T,
  delay: number,
  options: DebounceOptions = {}
): DebouncedCallback<T> {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingArgsRef = useRef<Parameters<T> | null>(null);
  const callbackRef = useRef(callback);
  const flushOnUnmountRef = useRef(options.flushOnUnmount ?? false);
  flushOnUnmountRef.current = options.flushOnUnmount ?? false;
  const unmountedRef = useRef(false);

  // Update callback ref when callback changes
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const debouncedCallback = useMemo(() => {
    const debounced = (...args: Parameters<T>) => {
      // A child can call in during its own unmount, after this hook's cleanup
      // ran; a timer scheduled now would outlive the component.
      if (unmountedRef.current && flushOnUnmountRef.current) {
        pendingArgsRef.current = null;
        callbackRef.current(...args);
        return;
      }

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      pendingArgsRef.current = args;
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null;
        pendingArgsRef.current = null;
        callbackRef.current(...args);
      }, delay);
    };
    debounced.cancel = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      pendingArgsRef.current = null;
    };
    debounced.flush = () => {
      const args = pendingArgsRef.current;
      if (!timeoutRef.current || !args) return undefined;
      debounced.cancel();
      return callbackRef.current(...args);
    };
    return debounced as DebouncedCallback<T>;
  }, [delay]);

  const latestDebouncedRef = useRef(debouncedCallback);
  latestDebouncedRef.current = debouncedCallback;

  // Cleanup on unmount
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      if (flushOnUnmountRef.current) {
        latestDebouncedRef.current.flush();
      } else if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
        pendingArgsRef.current = null;
      }
    };
  }, []);

  return debouncedCallback;
}

/**
 * A hook that creates an auto-save function with debouncing.
 * Includes a status indicator for save state.
 */
export function useAutoSave<T>(saveFunction: (data: T) => Promise<void>, delay: number = 1000) {
  const statusRef = useRef<"idle" | "saving" | "saved" | "error">("idle");
  const pendingDataRef = useRef<T | null>(null);
  const isSavingRef = useRef(false);

  const save = useCallback(
    async (data: T) => {
      // If already saving, queue this data for next save
      if (isSavingRef.current) {
        pendingDataRef.current = data;
        return;
      }

      isSavingRef.current = true;
      statusRef.current = "saving";

      try {
        await saveFunction(data);
        statusRef.current = "saved";

        // Check if there's pending data to save
        if (pendingDataRef.current !== null) {
          const pending = pendingDataRef.current;
          pendingDataRef.current = null;
          isSavingRef.current = false;
          await save(pending);
        }
      } catch (error) {
        console.error("Auto-save error:", error);
        statusRef.current = "error";
      } finally {
        isSavingRef.current = false;
      }
    },
    [saveFunction]
  );

  const debouncedSave = useDebouncedCallback(save, delay);

  return {
    save: debouncedSave,
    getStatus: () => statusRef.current,
  };
}
