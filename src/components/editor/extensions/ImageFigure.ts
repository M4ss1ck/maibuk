import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { ImageView } from "../ImageView";

export interface ImageFigureOptions {
  HTMLAttributes: Record<string, unknown>;
  allowBase64: boolean;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    imageFigure: {
      setImageAlignment: (alignment: "left" | "center" | "right") => ReturnType;
      setImageWidth: (width: string | null) => ReturnType;
    };
  }
}

export const ImageFigure = Node.create<ImageFigureOptions>({
  name: "image",

  group: "block",

  atom: true,

  draggable: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      allowBase64: true,
    };
  },

  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: (el: HTMLElement) => {
          const img = el.tagName === "IMG" ? el : el.querySelector("img");
          return img?.getAttribute("src") || null;
        },
      },
      alt: {
        default: null,
        parseHTML: (el: HTMLElement) => {
          const img = el.tagName === "IMG" ? el : el.querySelector("img");
          return img?.getAttribute("alt") || null;
        },
      },
      title: {
        default: null,
        parseHTML: (el: HTMLElement) => {
          const img = el.tagName === "IMG" ? el : el.querySelector("img");
          return img?.getAttribute("title") || null;
        },
      },
      caption: {
        default: "",
        parseHTML: (el: HTMLElement) => {
          const figcaption = el.querySelector("figcaption");
          return figcaption?.textContent || "";
        },
        renderHTML: (attributes: { caption: string }) => ({
          "data-caption": attributes.caption || "",
        }),
      },
      width: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-width") || null,
        renderHTML: (attributes: { width: string | null }) =>
          attributes.width ? { "data-width": attributes.width } : {},
      },
      alignment: {
        default: "center",
        parseHTML: (el: HTMLElement) =>
          el.getAttribute("data-alignment") || "center",
        renderHTML: (attributes: { alignment: string }) => ({
          "data-alignment": attributes.alignment || "center",
        }),
      },
    };
  },

  parseHTML() {
    return [
      { tag: "figure[data-image]", priority: 60 },
      { tag: "figure", priority: 55, getAttrs: (el: HTMLElement) => {
        return el.querySelector("img") ? {} : false;
      }},
      { tag: "img[src]", priority: 50 },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const { src, alt, title, ...figureAttrs } = HTMLAttributes;
    return [
      "figure",
      mergeAttributes(this.options.HTMLAttributes, figureAttrs, {
        "data-image": "",
      }),
      ["img", { src, alt: alt || undefined, title: title || undefined }],
      ["figcaption", {}, HTMLAttributes["data-caption"] || ""],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },

  addCommands() {
    return {
      setImageAlignment:
        (alignment: "left" | "center" | "right") =>
        ({ commands }) => {
          return commands.updateAttributes("image", { alignment });
        },
      setImageWidth:
        (width: string | null) =>
        ({ commands }) => {
          return commands.updateAttributes("image", { width });
        },
    };
  },
});
