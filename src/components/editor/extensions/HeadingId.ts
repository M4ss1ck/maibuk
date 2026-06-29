// src/components/editor/extensions/HeadingId.ts
import { Extension } from "@tiptap/core";

/**
 * Adds a persisted `id` attribute to heading nodes so headings can be linked to
 * and so the id doubles as an export anchor. Ids are assigned at save time by
 * `assignHeadingIds` (chapter store) and by the link pickers; this extension only
 * preserves them through the editor round-trip.
 */
export const HeadingId = Extension.create({
  name: "headingId",
  addGlobalAttributes() {
    return [
      {
        types: ["heading"],
        attributes: {
          id: {
            default: null,
            parseHTML: (element) => element.getAttribute("id"),
            renderHTML: (attributes) => (attributes.id ? { id: attributes.id } : {}),
          },
        },
      },
    ];
  },
});
