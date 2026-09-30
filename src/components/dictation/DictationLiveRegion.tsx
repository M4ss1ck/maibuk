import { useDictationStore } from "@/features/dictation/store";

/**
 * The Dictation screen-reader announcements. It lives in the app shell
 * (beside the toasts) instead of the Dictation control so it survives a
 * screen change: a navigating Voice Command may unmount every editor, and the
 * author must still hear what the Session did.
 *
 * `data-live-announcer` is the marker React Aria keeps its own announcer
 * visible by: without it, an open Modal hides this region, and what the
 * Session says meanwhile (a refusal to close that dialog) is never heard.
 */
export function DictationLiveRegion() {
  const announcement = useDictationStore((s) => s.announcement);
  return (
    <div role="status" aria-live="polite" className="sr-only" data-live-announcer="true">
      {announcement}
    </div>
  );
}
