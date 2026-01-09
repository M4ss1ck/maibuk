import { Extension } from "@tiptap/core";

export interface TextIndentOptions {
  types: string[];
  minIndent: number;
  maxIndent: number;
  defaultIndent: number;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    textIndent: {
      increaseIndent: () => ReturnType;
      decreaseIndent: () => ReturnType;
      setIndent: (indent: number) => ReturnType;
      unsetIndent: () => ReturnType;
    };
  }
}

export const TextIndent = Extension.create<TextIndentOptions>({
  name: "textIndent",

  addOptions() {
    return {
      types: ["paragraph", "heading"],
      minIndent: 0,
      maxIndent: 200,
      defaultIndent: 40,
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          textIndent: {
            default: null,
            parseHTML: (element) => {
              const indent = element.style.marginLeft || element.style.textIndent;
              return indent ? parseInt(indent, 10) : null;
            },
            renderHTML: (attributes) => {
              if (!attributes.textIndent) {
                return {};
              }
              return {
                style: `margin-left: ${attributes.textIndent}px`,
              };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      increaseIndent:
        () =>
          ({ tr, state, dispatch }) => {
            const { selection } = state;
            const { from, to } = selection;

            state.doc.nodesBetween(from, to, (node, pos) => {
              if (this.options.types.includes(node.type.name)) {
                const currentIndent = node.attrs.textIndent || 0;
                const newIndent = Math.min(
                  currentIndent + this.options.defaultIndent,
                  this.options.maxIndent
                );

                if (dispatch) {
                  tr.setNodeMarkup(pos, undefined, {
                    ...node.attrs,
                    textIndent: newIndent,
                  });
                }
              }
            });

            return true;
          },

      decreaseIndent:
        () =>
          ({ tr, state, dispatch }) => {
            const { selection } = state;
            const { from, to } = selection;

            state.doc.nodesBetween(from, to, (node, pos) => {
              if (this.options.types.includes(node.type.name)) {
                const currentIndent = node.attrs.textIndent || 0;
                const newIndent = Math.max(
                  currentIndent - this.options.defaultIndent,
                  this.options.minIndent
                );

                if (dispatch) {
                  tr.setNodeMarkup(pos, undefined, {
                    ...node.attrs,
                    textIndent: newIndent || null,
                  });
                }
              }
            });

            return true;
          },

      setIndent:
        (indent: number) =>
          ({ tr, state, dispatch }) => {
            const { selection } = state;
            const { from, to } = selection;

            state.doc.nodesBetween(from, to, (node, pos) => {
              if (this.options.types.includes(node.type.name)) {
                if (dispatch) {
                  tr.setNodeMarkup(pos, undefined, {
                    ...node.attrs,
                    textIndent: indent || null,
                  });
                }
              }
            });

            return true;
          },

      unsetIndent:
        () =>
          ({ tr, state, dispatch }) => {
            const { selection } = state;
            const { from, to } = selection;

            state.doc.nodesBetween(from, to, (node, pos) => {
              if (this.options.types.includes(node.type.name)) {
                if (dispatch) {
                  tr.setNodeMarkup(pos, undefined, {
                    ...node.attrs,
                    textIndent: null,
                  });
                }
              }
            });

            return true;
          },
    };
  },
});
