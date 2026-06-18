import { useEffect } from "react";
import { useShortcuts } from "../../lib/shortcuts";
import { useSettingsStore } from "../../features/settings/store";

/** Resolve a wheel event into a zoom direction, or null if it should be ignored. */
export function wheelZoomDirection(event: WheelEvent): "in" | "out" | null {
  if (!(event.ctrlKey || event.metaKey)) return null;
  if (event.deltaY === 0) return null;
  return event.deltaY < 0 ? "in" : "out";
}

/**
 * Wire editor page-zoom input: Ctrl/Cmd +/-/0 and Ctrl/Cmd + wheel over
 * `scrollEl`. Reads actions from the store imperatively so the registered
 * handlers stay stable.
 */
export function useEditorZoomControls(scrollEl: HTMLElement | null) {
  useShortcuts([
    {
      keys: ["ctrl+=", "meta+=", "ctrl++", "meta++", "ctrl+shift++", "meta+shift++"],
      allowInInput: true,
      onTrigger: () => useSettingsStore.getState().zoomIn(),
    },
    {
      keys: ["ctrl+-", "meta+-"],
      allowInInput: true,
      onTrigger: () => useSettingsStore.getState().zoomOut(),
    },
    {
      keys: ["ctrl+0", "meta+0"],
      allowInInput: true,
      onTrigger: () => useSettingsStore.getState().resetZoom(),
    },
  ]);

  useEffect(() => {
    if (!scrollEl) return;
    const handleWheel = (event: WheelEvent) => {
      const direction = wheelZoomDirection(event);
      if (!direction) return;
      event.preventDefault();
      const store = useSettingsStore.getState();
      if (direction === "in") store.zoomIn();
      else store.zoomOut();
    };
    scrollEl.addEventListener("wheel", handleWheel, { passive: false });
    return () => scrollEl.removeEventListener("wheel", handleWheel);
  }, [scrollEl]);
}
