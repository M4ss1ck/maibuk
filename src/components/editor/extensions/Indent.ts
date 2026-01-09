import { Extension } from "@tiptap/core";

export interface IndentOptions {
  types: string[];
  minIndent: number;
  maxIndent: number;
  defaultIndent: number;
}

/**
 * Parse an indent value string (px, pt, em, rem) and convert to pixels.
 * Handles pasted content from Google Docs, Word, etc.
 */
function parseIndentValue(value: string): number | null {
  if (!value) return null;

  const numMatch = value.match(/^(-?\d+(?:\.\d+)?)(px|pt|em|rem)?$/);
  if (numMatch) {
    const numValue = parseFloat(numMatch[1]);
    const unit = numMatch[2] || "px";

    let pxValue: number;
    if (unit === "pt") {
      pxValue = numValue * 1.333; // 1pt ≈ 1.333px
    } else if (unit === "em" || unit === "rem") {
      pxValue = numValue * 16; // Assume 16px base font size
    } else {
      pxValue = numValue;
    }

    // Round to nearest 40px increment for consistency
    const rounded = Math.round(pxValue / 40) * 40;
    return rounded > 0 ? rounded : null;
  }

  return null;
}

/**
 * Normalize text-indent values from various sources to consistent pixels.
 * Google Docs typically uses 36pt (~48px) for first-line indentation.
 */
function normalizeTextIndent(value: string): number | null {
  if (!value || value === "0" || value === "0px") return null;

  const numMatch = value.match(/^(-?\d+(?:\.\d+)?)(px|pt|em|rem)?$/);
  if (numMatch) {
    const numValue = parseFloat(numMatch[1]);
    const unit = numMatch[2] || "px";

    let pxValue: number;
    if (unit === "pt") {
      pxValue = numValue * 1.333;
    } else if (unit === "em" || unit === "rem") {
      pxValue = numValue * 16;
    } else {
      pxValue = numValue;
    }

    // Normalize to 40px increments
    if (pxValue > 20) {
      const level = Math.round(pxValue / 40);
      return level * 40;
    }
  }

  return null;
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
              // Check both margin-left and padding-left (Google Docs uses both)
              const marginLeft = element.style.marginLeft;
              const paddingLeft = element.style.paddingLeft;
              const indentValue = marginLeft || paddingLeft;
              return parseIndentValue(indentValue);
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
              const textIndent = element.style.textIndent;
              return normalizeTextIndent(textIndent);
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
