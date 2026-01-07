import { Mark, mergeAttributes } from "@tiptap/core";

export interface FootnoteOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    footnote: {
      setFootnote: (attributes: { content: string }) => ReturnType;
      unsetFootnote: () => ReturnType;
    };
  }
}

export const Footnote = Mark.create<FootnoteOptions>({
  name: "footnote",

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      content: {
        default: "",
        parseHTML: (element: HTMLElement) => element.getAttribute("data-footnote-content"),
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
    return [
      {
        tag: "span[data-footnote]",
      },
    ];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return [
      "span",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-footnote": "",
        class: "footnote-marker",
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setFootnote:
        (attributes: { content: string }) =>
          ({ commands }: { commands: any }) => {
            const id = `fn-${Date.now()}`;
            return commands.setMark(this.name, { ...attributes, id });
          },
      unsetFootnote:
        () =>
          ({ commands }: { commands: any }) => {
            return commands.unsetMark(this.name);
          },
    };
  },
});
