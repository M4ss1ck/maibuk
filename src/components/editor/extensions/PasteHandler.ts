import { Slice, Fragment, Node } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Extension } from "@tiptap/core";

/**
 * PasteHandler extension to properly handle pasted content from external sources
 * like Google Docs, Microsoft Word, etc.
 *
 * Handles:
 * - Background colors / highlights
 * - Paragraph spacing
 * - Text indentation
 */
export const PasteHandler = Extension.create({
  name: "pasteHandler",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("pasteHandler"),
        props: {
          transformPastedHTML(html: string) {
            // Create a temporary DOM element to parse the HTML
            const doc = new DOMParser().parseFromString(html, "text/html");

            // Google Docs wraps content in a <b> tag with id containing "docs-internal-guid"
            // We need to unwrap this and process all paragraphs equally
            unwrapGoogleDocsWrapper(doc.body);

            // Process all elements for Google Docs specific transforms
            processGoogleDocsContent(doc.body);

            return doc.body.innerHTML;
          },

          // Handle the pasted slice to preserve marks and node attributes
          transformPasted(slice: Slice) {
            // The issue: When pasting, ProseMirror may "open" the first node to merge
            // it with the existing paragraph at the cursor. This causes the first
            // paragraph's attributes (like textIndent) to be lost.
            //
            // Solution: If the first paragraph has special attributes (indent, textIndent),
            // we set openStart to 0 to prevent merging and preserve all formatting.

            const processFragment = (fragment: Fragment): Fragment => {
              const nodes: Node[] = [];

              fragment.forEach((node) => {
                if (node.isText) {
                  // Text nodes keep their marks
                  nodes.push(node);
                } else if (node.content.size > 0) {
                  // Recursively process child content
                  const newContent = processFragment(node.content);
                  nodes.push(node.copy(newContent));
                } else {
                  nodes.push(node);
                }
              });

              return Fragment.from(nodes);
            };

            const newContent = processFragment(slice.content);

            // Check if the first node has indent attributes that would be lost
            let newOpenStart = slice.openStart;
            if (slice.openStart > 0 && newContent.firstChild) {
              const firstNode = newContent.firstChild;
              // Check for indent-related attributes
              const hasIndentAttrs =
                (firstNode.attrs.indent && firstNode.attrs.indent > 0) ||
                (firstNode.attrs.firstLineIndent &&
                  firstNode.attrs.firstLineIndent !== null);

              if (hasIndentAttrs) {
                // Set openStart to 0 to prevent merging with existing paragraph
                // This ensures the first paragraph keeps its indentation
                newOpenStart = 0;
              }
            }

            return new Slice(newContent, newOpenStart, slice.openEnd);
          },
        },
      }),
    ];
  },
});

/**
 * Unwrap Google Docs wrapper elements that can cause the first paragraph to be
 * treated differently. Google Docs wraps content in a <b> tag with an id like
 * "docs-internal-guid-..." which can interfere with paragraph parsing.
 */
function unwrapGoogleDocsWrapper(container: HTMLElement): void {
  // Find the Google Docs wrapper (usually a <b> with id containing "docs-internal-guid")
  const wrapper = container.querySelector('b[id*="docs-internal-guid"]');

  if (wrapper && wrapper.parentElement) {
    // Move all children of the wrapper to its parent
    const parent = wrapper.parentElement;
    while (wrapper.firstChild) {
      parent.insertBefore(wrapper.firstChild, wrapper);
    }
    // Remove the now-empty wrapper
    wrapper.remove();
  }

  // Also handle cases where Google Docs wraps content in a <span> with the same id pattern
  const spanWrapper = container.querySelector('span[id*="docs-internal-guid"]');
  if (spanWrapper && spanWrapper.parentElement) {
    const parent = spanWrapper.parentElement;
    while (spanWrapper.firstChild) {
      parent.insertBefore(spanWrapper.firstChild, spanWrapper);
    }
    spanWrapper.remove();
  }
}

/**
 * Process Google Docs specific content transformations
 */
function processGoogleDocsContent(container: HTMLElement): void {
  // First, ensure all paragraphs have their styles properly set
  // This is important for the first paragraph which might be inside a wrapper
  const paragraphs = container.querySelectorAll("p");
  paragraphs.forEach((p) => {
    if (p instanceof HTMLElement) {
      // Ensure text-indent is preserved from inline styles
      const textIndent = p.style.textIndent;
      if (textIndent && textIndent !== "0" && textIndent !== "0px") {
        // Re-set it to ensure it's captured
        p.style.textIndent = textIndent;
      }
    }
  });

  // Process all elements
  const allElements = container.querySelectorAll("*");

  allElements.forEach((element) => {
    if (!(element instanceof HTMLElement)) return;

    // Handle highlight/background colors
    transformHighlight(element);

    // Handle paragraph spacing
    transformParagraphSpacing(element);

    // Handle indentation
    transformIndentation(element);

    // Clean up Google Docs specific attributes
    cleanupGoogleDocsAttributes(element);
  });

  // Handle Google Docs wrapped spans that have inline styles
  const spans = container.querySelectorAll("span");
  spans.forEach((span) => {
    if (!(span instanceof HTMLElement)) return;
    transformSpanStyles(span);
  });
}

/**
 * Transform background-color styles to <mark> elements for highlight support
 */
function transformHighlight(element: HTMLElement): void {
  const bgColor = element.style.backgroundColor;

  if (bgColor && bgColor !== "transparent" && bgColor !== "inherit") {
    // Convert background-color to data attribute for Highlight extension
    // The Highlight extension uses data-color attribute
    if (element.tagName.toLowerCase() === "span") {
      // Wrap content in a mark element if it has a background color
      // First, set the highlight color
      element.setAttribute("data-color", bgColor);

      // Also keep the style for visual consistency during paste
      element.style.backgroundColor = bgColor;
    }
  }
}

/**
 * Handle paragraph spacing from Google Docs
 * Google Docs often uses margin-top/bottom for paragraph separation
 */
function transformParagraphSpacing(element: HTMLElement): void {
  if (element.tagName.toLowerCase() === "p") {
    // Google Docs uses line-height and margin for spacing
    // We preserve these as inline styles that can be rendered
    const marginTop = element.style.marginTop;
    const marginBottom = element.style.marginBottom;
    const lineHeight = element.style.lineHeight;

    // Keep meaningful spacing values
    if (marginTop || marginBottom) {
      // Normalize to reasonable values if they're too extreme
      const normalizeMargin = (margin: string): string => {
        if (!margin) return "";
        const value = parseFloat(margin);
        if (isNaN(value)) return margin;
        // Cap at reasonable values (24px = ~1.5em)
        const maxMargin = 24;
        if (value > maxMargin) {
          return `${maxMargin}px`;
        }
        return margin;
      };

      if (marginTop) {
        element.style.marginTop = normalizeMargin(marginTop);
      }
      if (marginBottom) {
        element.style.marginBottom = normalizeMargin(marginBottom);
      }
    }

    // Keep line-height for readability
    if (lineHeight) {
      element.style.lineHeight = lineHeight;
    }
  }
}

/**
 * Transform indentation from Google Docs
 * Google Docs uses margin-left and text-indent for indentation
 * - margin-left: Whole paragraph indentation
 * - text-indent: First-line indentation
 */
function transformIndentation(element: HTMLElement): void {
  const marginLeft = element.style.marginLeft;
  const textIndent = element.style.textIndent;
  const paddingLeft = element.style.paddingLeft;

  // Keep margin-left for whole paragraph indentation
  if (marginLeft) {
    element.style.marginLeft = marginLeft;
  } else if (paddingLeft) {
    // Convert padding-left to margin-left
    element.style.marginLeft = paddingLeft;
  }

  // Keep text-indent for first-line indentation (separate attribute)
  // This is commonly used in Google Docs for paragraph first-line indents
  if (
    textIndent &&
    textIndent !== "0" &&
    textIndent !== "0px" &&
    textIndent !== "0pt"
  ) {
    element.style.textIndent = textIndent;
  }
}

/**
 * Transform span styles from Google Docs
 * Google Docs wraps styled text in spans with inline styles
 */
function transformSpanStyles(span: HTMLElement): void {
  // Handle font-weight
  const fontWeight = span.style.fontWeight;
  if (
    fontWeight === "bold" ||
    fontWeight === "700" ||
    parseInt(fontWeight) >= 600
  ) {
    // The Bold extension should pick this up, but ensure the style is present
    span.style.fontWeight = "bold";
  }

  // Handle font-style (italic)
  const fontStyle = span.style.fontStyle;
  if (fontStyle === "italic") {
    span.style.fontStyle = "italic";
  }

  // Handle text-decoration (underline, strikethrough)
  const textDecoration =
    span.style.textDecoration || span.style.textDecorationLine;
  if (textDecoration) {
    if (textDecoration.includes("underline")) {
      span.style.textDecoration = "underline";
    }
    if (textDecoration.includes("line-through")) {
      span.style.textDecoration = "line-through";
    }
  }

  // Handle color
  const color = span.style.color;
  if (
    color &&
    color !== "inherit" &&
    color !== "rgb(0, 0, 0)" &&
    color !== "#000000"
  ) {
    span.style.color = color;
  }

  // Handle font-size
  const fontSize = span.style.fontSize;
  if (fontSize) {
    span.style.fontSize = fontSize;
  }

  // Handle font-family
  const fontFamily = span.style.fontFamily;
  if (fontFamily) {
    // Clean up Google Docs font names
    span.style.fontFamily = fontFamily.replace(/^["']|["']$/g, "");
  }
}

/**
 * Clean up Google Docs specific attributes that are not needed
 */
function cleanupGoogleDocsAttributes(element: HTMLElement): void {
  // Remove Google Docs specific attributes
  const attributesToRemove = [
    "id",
    "class",
    "data-docs-internal-guid",
    "dir",
    "role",
  ];

  attributesToRemove.forEach((attr) => {
    // Only remove class if it's a Google Docs specific class
    if (attr === "class") {
      const className = element.getAttribute("class");
      if (
        className &&
        (className.includes("docs-") || className.includes("kix-"))
      ) {
        element.removeAttribute("class");
      }
    } else if (attr === "id") {
      const id = element.getAttribute("id");
      if (id && (id.includes("docs-") || id.includes("kix-"))) {
        element.removeAttribute("id");
      }
    } else {
      // For data-docs attributes, always remove
      if (attr.startsWith("data-docs")) {
        element.removeAttribute(attr);
      }
    }
  });

  // Remove all data-docs-* attributes
  Array.from(element.attributes).forEach((attr) => {
    if (attr.name.startsWith("data-docs-") || attr.name.startsWith("data-kix-")) {
      element.removeAttribute(attr.name);
    }
  });
}

export default PasteHandler;
