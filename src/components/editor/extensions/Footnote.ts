import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { FootnoteView } from "../FootnoteView";

export interface FootnoteOptions {
  HTMLAttributes: Record<string, unknown>;
  startIndex: number;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    footnote: {
      insertFootnote: (attributes: { content: string }) => ReturnType;
    };
  }
}

export const Footnote = Node.create<FootnoteOptions>({
  name: "footnote",

  group: "inline",

  inline: true,

  atom: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      startIndex: 1,
    };
  },

  addAttributes() {
    return {
      content: {
        default: "",
        parseHTML: (element: HTMLElement) => element.getAttribute("data-footnote-content") || "",
        renderHTML: (attributes: { content: string }) => ({
          "data-footnote-content": attributes.content,
        }),
      },
      id: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("data-footnote-id"),
        renderHTML: (attributes: { id: string }) => ({
          "data-footnote-id": attributes.id,
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "sup[data-footnote]", priority: 51 }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return [
      "sup",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-footnote": "",
      }),
      "*",
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FootnoteView);
  },

  addCommands() {
    return {
      insertFootnote:
        (attributes: { content: string }) =>
        ({ commands }: { commands: any }) => {
          const id = `fn-${Date.now()}`;
          return commands.insertContent({
            type: this.name,
            attrs: { ...attributes, id },
          });
        },
    };
  },
});
