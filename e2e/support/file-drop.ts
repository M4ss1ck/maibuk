// A file drop onto a surface. Dropping files from a file manager is a pointer
// gesture no key reaches, and a spec may not make the events itself: the
// keyboard contract refuses `dispatchEvent` and `evaluate` in a spec, the same
// reason `e2e/support/file-picker.ts` stands in for the native chooser. The
// page's own drop handler then runs as it would for a real drag, so what the
// spec asserts is the app's response to the drop.

import type { Locator } from "@playwright/test";

/**
 * A file to drop: a real document's bytes, a PNG drawn in the page, or plain
 * text for a file to refuse.
 */
export interface DroppedFile {
  name: string;
  type: string;
  /**
   * The file's own bytes, base64, for a document the page cannot draw: the
   * spec reads a committed fixture (a PDF, an EPUB) and hands it over. Read
   * before every other body, so the dropped file is that file byte for byte.
   */
  base64?: string;
  /** Draw a PNG of this size inside the file, so it is a real picture. */
  image?: { width: number; height: number };
  /** The file's text, for a file that is not an image. */
  text?: string;
}

/**
 * Drops `files` onto `target`, at `at` (viewport coordinates) or at the middle
 * of `target`: the `dragover` a file manager sends before it, then the `drop`
 * carrying the files. Nothing else happens: a file that is no picture is left
 * for the app to see and refuse. A file with `base64` is decoded back into the
 * bytes it was read from, so a dropped document is the fixture's own file.
 */
export async function dropFiles(
  target: Locator,
  files: readonly DroppedFile[],
  at?: { x: number; y: number }
): Promise<void> {
  await target.evaluate(
    async (
      element,
      { dropped, point }: { dropped: DroppedFile[]; point?: { x: number; y: number } }
    ) => {
      const draw = async ({ width, height }: { width: number; height: number }): Promise<Blob> => {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (context === null) throw new Error("this page cannot draw a canvas");
        context.fillStyle = "#3366cc";
        context.fillRect(0, 0, width, height);
        const blob = await new Promise<Blob | null>((resolve) => {
          canvas.toBlob(resolve, "image/png");
        });
        if (blob === null) throw new Error("this page cannot encode a PNG");
        return blob;
      };

      // The bytes a real file carries, decoded from the base64 the spec read.
      const bytesOf = (base64: string): ArrayBuffer => {
        const binary = atob(base64);
        return Uint8Array.from(binary, (char) => char.charCodeAt(0)).buffer as ArrayBuffer;
      };

      const transfer = new DataTransfer();
      for (const file of dropped) {
        const body: BlobPart[] =
          file.base64 !== undefined
            ? [bytesOf(file.base64)]
            : file.image === undefined
              ? [file.text ?? ""]
              : [await draw(file.image)];
        transfer.items.add(new File(body, file.name, { type: file.type }));
      }

      const box = element.getBoundingClientRect();
      const centre = point ?? { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      const send = (type: string) =>
        element.dispatchEvent(
          new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            clientX: centre.x,
            clientY: centre.y,
            dataTransfer: transfer,
          })
        );
      send("dragover");
      send("drop");
    },
    { dropped: [...files], point: at }
  );
}
