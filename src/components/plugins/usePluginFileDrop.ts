import { useEffect, useState } from "react";
import { deliverPluginFileDrop, getPluginFileGrantStore } from "@/features/plugins/file-grants";
import type { PluginLifecycle } from "@/features/plugins/types";
import type { PluginDroppedFile } from "@/lib/platform/types";
import { IS_TAURI } from "@/lib/platform";

/**
 * Routes an OS or browser file drop on a Plugin's page to that Plugin (#828).
 *
 * Only the page under the drop point claims a file drop: it answers `dragover`
 * with `dropEffect = "copy"` and takes `drop` only while its broker
 * `accepts("files.dropped")` (subscribed and still holding `files:pick`). Over
 * anything else the events are left untouched, so a drop never reaches a Plugin
 * the author did not drop it on. No visual indicator is drawn.
 *
 * The boolean it returns says a file drag is over the window and this page
 * accepts it, so the page can let the drop through an embedded Frame instead of
 * the iframe swallowing it.
 *
 * The web build takes each dropped file's `getAsFileSystemHandle()` inside the
 * drop event, synchronously: the browser keeps that handle valid only for the
 * event's own turn, so an await before it would lose it. The desktop build
 * listens to Tauri's OS drop (the webview never delivers it to the DOM) and
 * hit-tests the point against the page.
 */
export function usePluginFileDrop(
  lifecycle: PluginLifecycle | null,
  pluginId: string,
  pageId: string,
  element: HTMLElement | null
): boolean {
  const [draggingFile, setDraggingFile] = useState(false);

  // The element arrives through a state callback ref: the page's element mounts
  // only after its loading state, so the listeners attach once it exists.
  useEffect(() => {
    if (element === null) return;
    if (IS_TAURI) {
      let unlisten: (() => void) | undefined;
      let cancelled = false;
      void (async () => {
        let dispose: (() => void) | undefined;
        try {
          const { getCurrentWebview } = await import("@tauri-apps/api/webview");
          dispose = await getCurrentWebview().onDragDropEvent((event) => {
            const payload = event.payload;
            if (payload.type !== "drop") return;
            const broker = lifecycle?.runtime(pluginId)?.broker;
            const store = getPluginFileGrantStore();
            if (!broker?.accepts("files.dropped") || !store) return;
            const bounds = element.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            const point = { x: payload.position.x / dpr, y: payload.position.y / dpr };
            if (
              point.x < bounds.left ||
              point.x > bounds.right ||
              point.y < bounds.top ||
              point.y > bounds.bottom
            ) {
              return;
            }
            void deliverPluginFileDrop(
              { pluginId, page: pageId, broker, store },
              payload.paths.map((path) => ({ path }))
            );
          });
        } catch {
          return;
        }
        if (cancelled) dispose();
        else unlisten = dispose;
      })();

      return () => {
        cancelled = true;
        unlisten?.();
      };
    }

    const hasFiles = (event: DragEvent) => {
      const transfer = event.dataTransfer;
      return transfer !== null && Array.from(transfer.types).includes("Files");
    };
    // Read at event time, never cached: a Plugin may stop or lose `files:pick`
    // between two drags.
    const accepts = () => lifecycle?.runtime(pluginId)?.broker.accepts("files.dropped") === true;

    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event) || !accepts()) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const onDrop = (event: DragEvent) => {
      const broker = lifecycle?.runtime(pluginId)?.broker;
      const store = getPluginFileGrantStore();
      if (!broker?.accepts("files.dropped") || store === null) return;
      event.preventDefault();
      event.stopPropagation();
      const files: PluginDroppedFile[] = [];
      const items = event.dataTransfer ? Array.from(event.dataTransfer.items) : [];
      for (const item of items) {
        if (item.kind !== "file") continue;
        const file = item.getAsFile();
        if (file === null) continue;
        const readHandle = (
          item as DataTransferItem & {
            getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>;
          }
        ).getAsFileSystemHandle;
        files.push({
          file,
          handle: typeof readHandle === "function" ? readHandle.call(item) : null,
        });
      }
      void deliverPluginFileDrop({ pluginId, page: pageId, broker, store }, files);
    };
    const onDragEnter = (event: DragEvent) => {
      if (hasFiles(event) && accepts()) setDraggingFile(true);
    };
    const endDrag = () => setDraggingFile(false);
    const onDragLeave = (event: DragEvent) => {
      // relatedTarget null means the pointer left the window, not one element
      // for another.
      if (event.relatedTarget === null) endDrag();
    };

    element.addEventListener("dragover", onDragOver);
    element.addEventListener("drop", onDrop);
    // Capture phase: the page's own drop stops propagation, and the drag state
    // must still end so the Frame takes the pointer back.
    document.addEventListener("dragenter", onDragEnter, true);
    document.addEventListener("drop", endDrag, true);
    document.addEventListener("dragend", endDrag, true);
    document.addEventListener("dragleave", onDragLeave, true);
    return () => {
      element.removeEventListener("dragover", onDragOver);
      element.removeEventListener("drop", onDrop);
      document.removeEventListener("dragenter", onDragEnter, true);
      document.removeEventListener("drop", endDrag, true);
      document.removeEventListener("dragend", endDrag, true);
      document.removeEventListener("dragleave", onDragLeave, true);
    };
  }, [element, lifecycle, pluginId, pageId]);

  return draggingFile;
}
