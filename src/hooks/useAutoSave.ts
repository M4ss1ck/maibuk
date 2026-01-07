import { useRef, useEffect, useCallback } from "react";

/**
 * A hook that debounces a callback function.
 * The callback will only be executed after the specified delay has passed
 * without any new calls.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useDebouncedCallback<T extends (...args: any[]) => any>(
  callback: T,
  delay: number
): T {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbackRef = useRef(callback);

  // Update callback ref when callback changes
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const debouncedCallback = useCallback(
    (...args: Parameters<T>) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        callbackRef.current(...args);
      }, delay);
    },
    [delay]
  ) as T;

  return debouncedCallback;
}

/**
 * A hook that creates an auto-save function with debouncing.
 * Includes a status indicator for save state.
 */
export function useAutoSave<T>(
  saveFunction: (data: T) => Promise<void>,
  delay: number = 1000
) {
  const statusRef = useRef<"idle" | "saving" | "saved" | "error">("idle");
  const pendingDataRef = useRef<T | null>(null);
  const isSavingRef = useRef(false);

  const save = useCallback(async (data: T) => {
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
  }, [saveFunction]);

  const debouncedSave = useDebouncedCallback(save, delay);

  return {
    save: debouncedSave,
    getStatus: () => statusRef.current,
  };
}
