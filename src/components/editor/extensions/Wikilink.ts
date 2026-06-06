// src/components/editor/extensions/Wikilink.ts
import { mergeAttributes, Node } from "@tiptap/core";

export interface WikilinkAttrs {
  href: string | null; // maibuk:// URI when bound; null when unresolved
  label: string;
}

/**
 * Inline atom node for `[[ ]]` note links. Bound links render as a maibuk anchor;
 * unresolved links render with a `wikilink-broken` class and a `data-label` so the
 * UI can offer to create a note (D6).
 */
export const Wikilink = Node.create({
  name: "wikilink",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      href: { default: null },
      label: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: "a.wikilink",
        getAttrs: (el) => {
          const element = el as HTMLElement;
          return {
            href: element.getAttribute("href"),
            label:
              element.getAttribute("data-label") ?? element.textContent ?? "",
          };
        },
      },
    ];
  },

  renderHTML({ node }) {
    const href = node.attrs.href as string | null;
    const label = (node.attrs.label as string) ?? "";
    if (href) {
      return [
        "a",
        mergeAttributes({ class: "wikilink", href, "data-type": "wikilink" }),
        label,
      ];
    }
    return [
      "a",
      mergeAttributes({
        class: "wikilink wikilink-broken",
        "data-label": label,
        "data-type": "wikilink",
      }),
      label,
    ];
  },

  renderText({ node }) {
    return `[[${node.attrs.label}]]`;
  },
});
