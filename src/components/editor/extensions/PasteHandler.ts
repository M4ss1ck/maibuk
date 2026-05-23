import { Slice, Fragment, Node } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Extension } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";
import { useSettingsStore } from "../../../features/settings/store";
import { cleanPastedHtml } from "../paste-cleanup";

/**
 * PasteHandler extension for content pasted from external sources like Google
 * Docs and Microsoft Word.
 *
 * HTML cleanup (style stripping, custom rules) is delegated to the configurable
 * paste-cleanup engine. This extension also handles image/blob paste and drop,
 * and preserves indent attributes on the pasted ProseMirror slice.
 */
export const PasteHandler = Extension.create({
  name: "pasteHandler",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("pasteHandler"),
        props: {
          handlePaste(view, event) {
            const clipboardData = event.clipboardData;
            if (!clipboardData) return false;

            const items = Array.from(clipboardData.items);
            const imageItem = items.find((item) =>
              item.type.startsWith("image/"),
            );

            if (imageItem) {
              const file = imageItem.getAsFile();
              if (file) {
                readImageAsDataUrl(file, view);
                return true;
              }
            }

            // Handle HTML paste containing blob: URLs (e.g. screenshots in
            // Tauri webview where image/* clipboard items aren't exposed).
            const html = clipboardData.getData("text/html");
            if (html && /\bblob:/.test(html)) {
              convertBlobImagesInHtml(html, view);
              return true;
            }

            return false;
          },

          handleDrop(view, event) {
            if (!event.dataTransfer?.files?.length) return false;

            const imageFile = Array.from(event.dataTransfer.files).find((f) =>
              f.type.startsWith("image/"),
            );
            if (!imageFile) return false;

            event.preventDefault();
            readImageAsDataUrl(imageFile, view, event);
            return true;
          },
          transformPastedHTML(html: string) {
            const settings = useSettingsStore.getState().pasteCleanup;
            return cleanPastedHtml(html, settings);
          },

          // Handle the pasted slice to preserve marks and node attributes
          transformPasted(slice: Slice) {
            // The issue: When pasting, ProseMirror may "open" the first node to merge
            // it with the existing paragraph at the cursor. This causes the first
            // paragraph's attributes (like textIndent) to be lost.
            //
            // Solution: If the first paragraph has special attributes (indent, textIndent),
            // we set openStart to 0 to prevent merging and preserve all formatting.

            const processFragment = (fragment: Fragment): Fragment => {
              const nodes: Node[] = [];

              fragment.forEach((node) => {
                if (node.isText) {
                  // Text nodes keep their marks
                  nodes.push(node);
                } else if (node.content.size > 0) {
                  // Recursively process child content
                  const newContent = processFragment(node.content);
                  nodes.push(node.copy(newContent));
                } else {
                  nodes.push(node);
                }
              });

              return Fragment.from(nodes);
            };

            const newContent = processFragment(slice.content);

            const containsImageNode = (fragment: Fragment): boolean => {
              let found = false;
              fragment.forEach((child) => {
                if (found) return;
                if (child.type.name === "image") {
                  found = true;
                  return;
                }
                if (child.content.size > 0) {
                  found = containsImageNode(child.content);
                }
              });
              return found;
            };

            // Check if the first node has indent attributes that would be lost
            let newOpenStart = slice.openStart;
            let newOpenEnd = slice.openEnd;

            // Prevent images from being "opened" and merged with surrounding text.
            if (containsImageNode(newContent)) {
              newOpenStart = 0;
              newOpenEnd = 0;
            }

            if (slice.openStart > 0 && newContent.firstChild) {
              const firstNode = newContent.firstChild;
              // Check for indent-related attributes
              const hasIndentAttrs =
                (firstNode.attrs.indent && firstNode.attrs.indent > 0) ||
                (firstNode.attrs.firstLineIndent &&
                  firstNode.attrs.firstLineIndent !== null);

              if (hasIndentAttrs) {
                // Set openStart to 0 to prevent merging with existing paragraph
                // This ensures the first paragraph keeps its indentation
                newOpenStart = 0;
              }
            }

            return new Slice(newContent, newOpenStart, newOpenEnd);
          },
        },
      }),
    ];
  },
});

/**
 * Read an image file as a data URL and insert it into the editor.
 * Used by both paste and drop handlers to avoid blob: URLs that don't persist.
 */
function readImageAsDataUrl(
  file: File,
  view: EditorView,
  dropEvent?: DragEvent,
): void {
  const reader = new FileReader();
  reader.onload = () => {
    const src = typeof reader.result === "string" ? reader.result : null;
    if (!src) return;

    const imageType = view.state.schema.nodes.image;
    if (!imageType) return;

    const node = imageType.create({ src, alt: null, title: null });

    if (dropEvent) {
      const coordinates = view.posAtCoords({
        left: dropEvent.clientX,
        top: dropEvent.clientY,
      });
      if (coordinates) {
        const tr = view.state.tr
          .insert(coordinates.pos, node)
          .setMeta("metrics:source", "paste");
        view.dispatch(tr.scrollIntoView());
        return;
      }
    }

    const tr = view.state.tr
      .replaceSelectionWith(node)
      .setMeta("metrics:source", "paste");
    view.dispatch(tr.scrollIntoView());
  };
  reader.readAsDataURL(file);
}

/**
 * Fetch blob: URLs in pasted HTML, convert them to data URLs, and insert
 * the resulting image nodes.  Blob URLs are ephemeral — they don't survive
 * a page reload, so we must materialise the data before saving.
 */
async function convertBlobImagesInHtml(
  html: string,
  view: EditorView,
): Promise<void> {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const blobImages = Array.from(
    doc.querySelectorAll<HTMLImageElement>('img[src^="blob:"]'),
  );

  if (blobImages.length === 0) return;

  const dataUrls = await Promise.all(
    blobImages.map(async (img) => {
      try {
        const response = await fetch(img.src);
        const blob = await response.blob();
        return await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => resolve("");
          reader.readAsDataURL(blob);
        });
      } catch {
        return "";
      }
    }),
  );

  const imageType = view.state.schema.nodes.image;
  if (!imageType) return;

  let tr = view.state.tr;
  for (const src of dataUrls) {
    if (!src) continue;
    const node = imageType.create({ src, alt: null, title: null });
    tr = tr.replaceSelectionWith(node);
  }

  if (tr.docChanged) {
    view.dispatch(tr.setMeta("metrics:source", "paste").scrollIntoView());
  }
}

export default PasteHandler;
