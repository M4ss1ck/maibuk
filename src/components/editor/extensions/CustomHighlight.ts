import { Mark, mergeAttributes } from "@tiptap/core";

export interface HighlightOptions {
  multicolor: boolean;
  HTMLAttributes: Record<string, string>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    customHighlight: {
      /**
       * Set a highlight mark
       */
      setHighlight: (attributes?: { color: string }) => ReturnType;
      /**
       * Toggle a highlight mark
       */
      toggleHighlight: (attributes?: { color: string }) => ReturnType;
      /**
       * Unset a highlight mark
       */
      unsetHighlight: () => ReturnType;
    };
  }
}

/**
 * Custom Highlight extension that properly handles pasted background colors
 * from Google Docs and other external sources.
 */
export const CustomHighlight = Mark.create<HighlightOptions>({
  name: "highlight",

  addOptions() {
    return {
      multicolor: true,
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    if (!this.options.multicolor) {
      return {};
    }

    return {
      color: {
        default: null,
        parseHTML: (element) => {
          // Try to get color from data attribute first
          const dataColor = element.getAttribute("data-color");
          if (dataColor) {
            return dataColor;
          }

          // Try to get from style background-color (Google Docs uses this)
          const bgColor = element.style.backgroundColor;
          if (bgColor && bgColor !== "transparent" && bgColor !== "inherit") {
            return bgColor;
          }

          // Try to get from style background
          const bg = element.style.background;
          if (
            bg &&
            !bg.includes("url") &&
            bg !== "transparent" &&
            bg !== "inherit"
          ) {
            // Extract color from background shorthand
            const colorMatch = bg.match(
              /^(#[0-9a-f]{3,8}|rgba?\([^)]+\)|[a-z]+)/i
            );
            if (colorMatch) {
              return colorMatch[1];
            }
          }

          return null;
        },
        renderHTML: (attributes) => {
          if (!attributes.color) {
            return {};
          }

          return {
            "data-color": attributes.color,
            style: `background-color: ${attributes.color}; border-radius: 0.25em; padding: 0.1em 0;`,
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "mark",
      },
      {
        tag: "span[data-color]",
      },
      {
        tag: "span[style]",
        getAttrs: (element) => {
          if (typeof element === "string") return false;

          const bgColor = (element as HTMLElement).style.backgroundColor;
          const bg = (element as HTMLElement).style.background;

          // Check if this span has a background color
          if (
            (bgColor && bgColor !== "transparent" && bgColor !== "inherit") ||
            (bg &&
              !bg.includes("url") &&
              bg !== "transparent" &&
              bg !== "inherit")
          ) {
            return {};
          }

          return false;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "mark",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
      0,
    ];
  },

  addCommands() {
    return {
      setHighlight:
        (attributes) =>
        ({ commands }) => {
          return commands.setMark(this.name, attributes);
        },
      toggleHighlight:
        (attributes) =>
        ({ commands }) => {
          return commands.toggleMark(this.name, attributes);
        },
      unsetHighlight:
        () =>
        ({ commands }) => {
          return commands.unsetMark(this.name);
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Shift-h": () => this.editor.commands.toggleHighlight(),
    };
  },
});

export default CustomHighlight;
