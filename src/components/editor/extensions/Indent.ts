import { Extension } from "@tiptap/core";

export interface IndentOptions {
  types: string[];
  minIndent: number;
  maxIndent: number;
  defaultIndent: number;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    indent: {
      // Paragraph indent (margin-left)
      increaseIndent: () => ReturnType;
      decreaseIndent: () => ReturnType;
      setIndent: (indent: number) => ReturnType;
      unsetIndent: () => ReturnType;
      // First-line indent (text-indent)
      increaseFirstLineIndent: () => ReturnType;
      decreaseFirstLineIndent: () => ReturnType;
      setFirstLineIndent: (indent: number) => ReturnType;
      unsetFirstLineIndent: () => ReturnType;
    };
  }
}

export const Indent = Extension.create<IndentOptions>({
  name: "indent",

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
          // Paragraph/block indent (margin-left)
          indent: {
            default: null,
            parseHTML: (element) => {
              const indent = element.style.marginLeft;
              return indent ? parseInt(indent, 10) : null;
            },
            renderHTML: (attributes) => {
              if (!attributes.indent) {
                return {};
              }
              return {
                style: `margin-left: ${attributes.indent}px`,
              };
            },
          },
          // First-line indent (text-indent)
          firstLineIndent: {
            default: null,
            parseHTML: (element) => {
              const indent = element.style.textIndent;
              return indent ? parseInt(indent, 10) : null;
            },
            renderHTML: (attributes) => {
              if (!attributes.firstLineIndent) {
                return {};
              }
              return {
                style: `text-indent: ${attributes.firstLineIndent}px`,
              };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      // Paragraph indent commands (margin-left)
      increaseIndent:
        () =>
          ({ tr, state, dispatch }) => {
            const { selection } = state;
            const { from, to } = selection;

            state.doc.nodesBetween(from, to, (node, pos) => {
              if (this.options.types.includes(node.type.name)) {
                const currentIndent = node.attrs.indent || 0;
                const newIndent = Math.min(
                  currentIndent + this.options.defaultIndent,
                  this.options.maxIndent
                );

                if (dispatch) {
                  tr.setNodeMarkup(pos, undefined, {
                    ...node.attrs,
                    indent: newIndent,
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
                const currentIndent = node.attrs.indent || 0;
                const newIndent = Math.max(
                  currentIndent - this.options.defaultIndent,
                  this.options.minIndent
                );

                if (dispatch) {
                  tr.setNodeMarkup(pos, undefined, {
                    ...node.attrs,
                    indent: newIndent || null,
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
                    indent: indent || null,
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
                    indent: null,
                  });
                }
              }
            });

            return true;
          },

      // First-line indent commands (text-indent)
      increaseFirstLineIndent:
        () =>
          ({ tr, state, dispatch }) => {
            const { selection } = state;
            const { from, to } = selection;

            state.doc.nodesBetween(from, to, (node, pos) => {
              if (this.options.types.includes(node.type.name)) {
                const currentIndent = node.attrs.firstLineIndent || 0;
                const newIndent = Math.min(
                  currentIndent + this.options.defaultIndent,
                  this.options.maxIndent
                );

                if (dispatch) {
                  tr.setNodeMarkup(pos, undefined, {
                    ...node.attrs,
                    firstLineIndent: newIndent,
                  });
                }
              }
            });

            return true;
          },

      decreaseFirstLineIndent:
        () =>
          ({ tr, state, dispatch }) => {
            const { selection } = state;
            const { from, to } = selection;

            state.doc.nodesBetween(from, to, (node, pos) => {
              if (this.options.types.includes(node.type.name)) {
                const currentIndent = node.attrs.firstLineIndent || 0;
                const newIndent = Math.max(
                  currentIndent - this.options.defaultIndent,
                  this.options.minIndent
                );

                if (dispatch) {
                  tr.setNodeMarkup(pos, undefined, {
                    ...node.attrs,
                    firstLineIndent: newIndent || null,
                  });
                }
              }
            });

            return true;
          },

      setFirstLineIndent:
        (indent: number) =>
          ({ tr, state, dispatch }) => {
            const { selection } = state;
            const { from, to } = selection;

            state.doc.nodesBetween(from, to, (node, pos) => {
              if (this.options.types.includes(node.type.name)) {
                if (dispatch) {
                  tr.setNodeMarkup(pos, undefined, {
                    ...node.attrs,
                    firstLineIndent: indent || null,
                  });
                }
              }
            });

            return true;
          },

      unsetFirstLineIndent:
        () =>
          ({ tr, state, dispatch }) => {
            const { selection } = state;
            const { from, to } = selection;

            state.doc.nodesBetween(from, to, (node, pos) => {
              if (this.options.types.includes(node.type.name)) {
                if (dispatch) {
                  tr.setNodeMarkup(pos, undefined, {
                    ...node.attrs,
                    firstLineIndent: null,
                  });
                }
              }
            });

            return true;
          },
    };
  },
});
