import { useCallback, useEffect, useRef, useState } from "react";
import type { DragEvent, RefObject } from "react";
import { toast } from "@/components/ui/Toast";
import {
  textDropExtension,
  textDropStem,
} from "@/features/markdown/dropped-file";
import i18n from "@/i18n";
import { IS_TAURI, getFileSystem } from "@/lib/platform";

/**
 * Drag-and-drop support for importing text files (.md/.markdown/.txt) onto a
 * container.
 *
 * Web build: native HTML5 drag events on the container handle the drop (unless
 * `disableWeb`, for containers whose web drops are owned elsewhere, e.g.
 * react-aria GridLists).
 *
 * Tauri build: the OS file drop is captured by the webview (it never reaches
 * the DOM), so we listen to Tauri's `onDragDropEvent` and hit-test the drop
 * position against the container's bounding box. Dropped files are read from
 * disk by path.
 *
 * `isDraggingFile` drives a visual highlight; `onDragMove` reports the hover
 * position (for insertion indicators); `onImport` receives all supported files
 * in one batch plus the drop point. Unsupported-only drops and unreadable
 * files surface as toasts — never silent.
 */

export interface DroppedTextFile {
  text: string;
  stem: string;
  extension: string;
}

export interface DropPoint {
  x: number;
  y: number;
}

export interface TextFileDropOptions {
  onImport: (files: DroppedTextFile[], point: DropPoint) => void | Promise<void>;
  onDragMove?: (point: DropPoint | null) => void;
  disableWeb?: boolean;
}

export function useTextFileDrop(
  containerRef: RefObject<HTMLElement | null>,
  { onImport, onDragMove, disableWeb = false }: TextFileDropOptions,
) {
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [isImportingFiles, setIsImportingFiles] = useState(false);
  const activeImportsRef = useRef(0);
  const onImportRef = useRef(onImport);
  onImportRef.current = onImport;
  const onDragMoveRef = useRef(onDragMove);
  onDragMoveRef.current = onDragMove;

  const beginImport = useCallback(() => {
    activeImportsRef.current += 1;
    setIsImportingFiles(true);
  }, []);

  const finishImport = useCallback(() => {
    activeImportsRef.current = Math.max(0, activeImportsRef.current - 1);
    setIsImportingFiles(activeImportsRef.current > 0);
  }, []);

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
    [containerRef],
  );

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
            const point = {
              x: payload.position.x / dpr,
              y: payload.position.y / dpr,
            };
            const inside = isInsideContainer(point.x, point.y);
            setIsDraggingFile(inside);
            onDragMoveRef.current?.(inside ? point : null);
            return;
          }

          if (payload.type === "drop") {
            setIsDraggingFile(false);
            onDragMoveRef.current?.(null);
            const point = {
              x: payload.position.x / dpr,
              y: payload.position.y / dpr,
            };
            if (!isInsideContainer(point.x, point.y)) return;

            const hasSupportedPath = payload.paths.some(
              (path) => textDropExtension(path) !== null,
            );
            if (hasSupportedPath) beginImport();

            void (async () => {
              try {
                const files = await readDroppedTauriPaths(payload.paths);
                if (files.length > 0) {
                  await onImportRef.current(files, point);
                }
              } catch (error) {
                console.error("Failed to import dropped files:", error);
                toast.error(i18n.t("dropImport.importFailed"));
              } finally {
                if (hasSupportedPath) finishImport();
              }
            })();
            return;
          }

          setIsDraggingFile(false);
          onDragMoveRef.current?.(null);
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
  }, [beginImport, finishImport, isInsideContainer]);

  const hasFile = (event: DragEvent) =>
    Array.from(event.dataTransfer.items).some((item) => item.kind === "file");

  const onDragOver = useCallback(
    (event: DragEvent) => {
      if (IS_TAURI || disableWeb || !hasFile(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setIsDraggingFile(true);
      onDragMoveRef.current?.({ x: event.clientX, y: event.clientY });
    },
    [disableWeb],
  );

  const onDragLeave = useCallback(
    (event: DragEvent) => {
      if (IS_TAURI || disableWeb) return;
      if (event.currentTarget.contains(event.relatedTarget as Node)) return;
      setIsDraggingFile(false);
      onDragMoveRef.current?.(null);
    },
    [disableWeb],
  );

  const onDrop = useCallback(
    (event: DragEvent) => {
      if (IS_TAURI || disableWeb) return;
      const all = Array.from(event.dataTransfer.files);
      if (all.length === 0) return;

      event.preventDefault();
      setIsDraggingFile(false);
      onDragMoveRef.current?.(null);
      const point = { x: event.clientX, y: event.clientY };
      const hasSupportedFile = all.some(
        (file) => textDropExtension(file.name) !== null,
      );
      if (hasSupportedFile) beginImport();

      void (async () => {
        try {
          const files = await readDroppedWebFiles(all);
          if (files.length > 0) {
            await onImportRef.current(files, point);
          }
        } catch (error) {
          console.error("Failed to import dropped files:", error);
          toast.error(i18n.t("dropImport.importFailed"));
        } finally {
          if (hasSupportedFile) finishImport();
        }
      })();
    },
    [beginImport, disableWeb, finishImport],
  );

  return {
    isDraggingFile,
    isImportingFiles,
    dropHandlers: { onDragOver, onDragLeave, onDrop },
  };
}

/** Reads browser File objects in order; toasts per read failure and when a
 * file-bearing drop contains nothing supported. */
export async function readDroppedWebFiles(
  all: File[],
): Promise<DroppedTextFile[]> {
  const supported = all.filter((file) => textDropExtension(file.name) !== null);
  if (supported.length === 0) {
    if (all.length > 0) toast.error(i18n.t("dropImport.noSupportedFiles"));
    return [];
  }

  const results: DroppedTextFile[] = [];
  for (const file of supported) {
    try {
      results.push({
        text: await file.text(),
        stem: textDropStem(file.name),
        extension: textDropExtension(file.name) as string,
      });
    } catch (error) {
      console.error("Failed to read dropped file:", file.name, error);
      toast.error(i18n.t("dropImport.readFailed", { name: file.name }));
    }
  }
  return results;
}

/** Reads Tauri file paths from disk in order; same toast rules as the web reader. */
export async function readDroppedTauriPaths(
  paths: string[],
): Promise<DroppedTextFile[]> {
  const supported = paths.filter((path) => textDropExtension(path) !== null);
  if (supported.length === 0) {
    if (paths.length > 0) toast.error(i18n.t("dropImport.noSupportedFiles"));
    return [];
  }

  const fs = await getFileSystem();
  const results: DroppedTextFile[] = [];
  for (const path of supported) {
    const name = path.split(/[\\/]/).pop() ?? path;
    try {
      const bytes = await fs.readFile(path);
      results.push({
        text: new TextDecoder().decode(bytes),
        stem: textDropStem(name),
        extension: textDropExtension(name) as string,
      });
    } catch (error) {
      console.error("Failed to read dropped file:", path, error);
      toast.error(i18n.t("dropImport.readFailed", { name }));
    }
  }
  return results;
}
