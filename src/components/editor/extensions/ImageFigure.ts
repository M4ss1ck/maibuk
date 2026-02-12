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

  content: "text*",

  selectable: true,

  draggable: true,

  isolating: true,

  defining: true,

  allowGapCursor: true,

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
        rendered: false,
        parseHTML: (el: HTMLElement) => {
          return el.getAttribute("data-caption") || "";
        },
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
      {
        tag: "figure[data-image]",
        priority: 60,
        getAttrs: (el: HTMLElement) => {
          const img = el.querySelector("img");
          if (!img) return false;
          return {
            src: img.getAttribute("src") || null,
            alt: img.getAttribute("alt") || null,
            title: img.getAttribute("title") || null,
            width: el.getAttribute("data-width") || null,
            alignment: el.getAttribute("data-alignment") || "center",
            caption: el.getAttribute("data-caption") || "",
          };
        },
        contentElement: "figcaption",
      },
      {
        tag: "figure",
        priority: 55,
        getAttrs: (el: HTMLElement) => {
          const img = el.querySelector("img");
          if (!img) return false;
          return {
            src: img.getAttribute("src") || null,
            alt: img.getAttribute("alt") || null,
            title: img.getAttribute("title") || null,
            width: el.getAttribute("data-width") || null,
            alignment: el.getAttribute("data-alignment") || "center",
            caption: el.getAttribute("data-caption") || "",
          };
        },
        contentElement: "figcaption",
      },
      {
        tag: "img[src]",
        priority: 50,
        getAttrs: (el: HTMLElement) => ({
          src: el.getAttribute("src") || null,
          alt: el.getAttribute("alt") || null,
          title: el.getAttribute("title") || null,
        }),
      },
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
      ["figcaption", 0],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageView, {
      stopEvent: ({ event }) => {
        const target = event.target as Node | null;
        const element = target instanceof Element ? target : null;
        if (!element) {
          return false;
        }

        if (element.closest("[data-node-view-content]")) {
          return false;
        }

        if (element.closest(".image-resize-handle")) {
          return true;
        }

        if (element.closest(".image-floating-toolbar")) {
          return true;
        }

        return false;
      },
    });
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
