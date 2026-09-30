import { useDictationStore } from "@/features/dictation/store";

/**
 * The Dictation screen-reader announcements. It lives in the app shell
 * (beside the toasts) instead of the Dictation control so it survives a
 * screen change: a navigating Voice Command may unmount every editor, and the
 * author must still hear what the Session did.
 */
export function DictationLiveRegion() {
  const announcement = useDictationStore((s) => s.announcement);
  return (
    <div role="status" aria-live="polite" className="sr-only">
      {announcement}
    </div>
  );
}
