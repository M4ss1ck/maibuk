import { toBlob } from "html-to-image";

const EXPORT_PADDING = 48;

/**
 * Rasterizes a live editor-content element to PNG bytes.
 *
 * Padding and a solid background are applied to the element for the duration
 * of the capture and restored afterwards. html-to-image sizes its canvas from
 * the *original* element's client box, so the padding must live on the real
 * element (not just the internal clone) for the export to get even margins on
 * all sides. The editor's tall min-height is collapsed so the image is cropped
 * to the actual content, and editing chrome is filtered out.
 */
export async function elementToPngBytes(element: HTMLElement): Promise<Uint8Array> {
  const backgroundColor = getComputedStyle(document.body).backgroundColor || "#ffffff";

  const previous = element.getAttribute("style");
  element.style.boxSizing = "content-box";
  element.style.padding = `${EXPORT_PADDING}px`;
  element.style.minHeight = "0";
  element.style.height = "auto";
  element.style.backgroundColor = backgroundColor;

  try {
    const blob = await toBlob(element, {
      pixelRatio: 2,
      backgroundColor,
      filter: (node) => {
        if (!(node instanceof HTMLElement)) return true;
        return (
          !node.classList.contains("image-floating-toolbar") &&
          !node.classList.contains("image-resize-handle") &&
          !node.classList.contains("code-block-copy")
        );
      },
    });
    if (!blob) throw new Error("Image export produced no data");
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    if (previous === null) {
      element.removeAttribute("style");
    } else {
      element.setAttribute("style", previous);
    }
  }
}
