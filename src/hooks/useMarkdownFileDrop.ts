import { useCallback, useEffect, useRef, useState } from "react";
import type { DragEvent, RefObject } from "react";
import { IS_TAURI, getFileSystem } from "@/lib/platform";

/**
 * Drag-and-drop support for importing `.md` files onto a list.
 *
 * Web build: native HTML5 drag events on the container handle the drop.
 *
 * Tauri build: the OS file drop is captured by the webview (it never reaches
 * the DOM), so we listen to Tauri's `onDragDropEvent` and hit-test the drop
 * position against the container's bounding box. The dropped file is read from
 * disk by path.
 *
 * In both cases `isDraggingFile` drives a visual highlight, and `onImport`
 * receives the file's text plus its name stem (filename without `.md`).
 */
export function useMarkdownFileDrop(
  containerRef: RefObject<HTMLElement | null>,
  onImport: (markdown: string, filenameStem: string) => void
) {
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const onImportRef = useRef(onImport);
  onImportRef.current = onImport;

  const isInsideContainer = useCallback(
    (clientX: number, clientY: number) => {
      const el = containerRef.current;
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      return (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      );
    },
    [containerRef]
  );

  // --- Tauri: native webview drag-drop events with position hit-testing ----
  useEffect(() => {
    if (!IS_TAURI) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      let dispose: (() => void) | undefined;
      try {
        const { getCurrentWebview } = await import("@tauri-apps/api/webview");
        dispose = await getCurrentWebview().onDragDropEvent((event) => {
          const payload = event.payload;
          const dpr = window.devicePixelRatio || 1;

          if (payload.type === "enter" || payload.type === "over") {
            const { x, y } = payload.position;
            setIsDraggingFile(isInsideContainer(x / dpr, y / dpr));
            return;
          }

          if (payload.type === "drop") {
            setIsDraggingFile(false);
            const { x, y } = payload.position;
            if (!isInsideContainer(x / dpr, y / dpr)) return;

            const mdPaths = payload.paths.filter((p) => p.toLowerCase().endsWith(".md"));
            void importPaths(mdPaths, onImportRef.current);
            return;
          }

          // "leave"
          setIsDraggingFile(false);
        });
      } catch {
        // No Tauri webview available (e.g. tests / non-desktop). Web DnD path
        // handles drops instead.
        return;
      }
      if (cancelled) dispose();
      else unlisten = dispose;
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [isInsideContainer]);

  // --- Web: HTML5 drag events spread onto the container -------------------
  const hasFile = (event: DragEvent) =>
    Array.from(event.dataTransfer.items).some((item) => item.kind === "file");

  const onDragOver = useCallback((event: DragEvent) => {
    if (IS_TAURI || !hasFile(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDraggingFile(true);
  }, []);

  const onDragLeave = useCallback((event: DragEvent) => {
    if (event.currentTarget.contains(event.relatedTarget as Node)) return;
    setIsDraggingFile(false);
  }, []);

  const onDrop = useCallback((event: DragEvent) => {
    if (IS_TAURI) return;
    const file = Array.from(event.dataTransfer.files).find((f) =>
      f.name.toLowerCase().endsWith(".md")
    );
    if (!file) return;

    event.preventDefault();
    setIsDraggingFile(false);

    const stem = file.name.replace(/\.md$/i, "");
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      onImportRef.current(text, stem);
    };
    reader.readAsText(file);
  }, []);

  return { isDraggingFile, dropHandlers: { onDragOver, onDragLeave, onDrop } };
}

/** Reads each `.md` path from disk and forwards its text to the importer. */
async function importPaths(
  paths: string[],
  onImport: (markdown: string, filenameStem: string) => void
) {
  if (paths.length === 0) return;
  const fs = await getFileSystem();
  for (const path of paths) {
    try {
      const bytes = await fs.readFile(path);
      const text = new TextDecoder().decode(bytes);
      const name = path.split(/[\\/]/).pop() ?? path;
      const stem = name.replace(/\.md$/i, "");
      onImport(text, stem);
    } catch (error) {
      console.error("Failed to read dropped Markdown file:", path, error);
    }
  }
}
