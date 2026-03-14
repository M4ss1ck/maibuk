/**
 * HTML-to-React-PDF content renderer.
 *
 * Converts sanitized HTML strings (from processChapterHtml) into
 * React-PDF element trees that can be embedded inside a <Page>.
 */
import { createElement, type ReactNode } from "react";
import { Text, View, Image, Link } from "@react-pdf/renderer";
import type { PdfStyles } from "./pdf-styles";

/**
 * Parses an HTML string and returns React-PDF elements.
 * The HTML is expected to be pre-sanitized by processChapterHtml().
 */
export function renderHtmlContent(
  html: string,
  styles: PdfStyles
): ReactNode[] {
  if (!html) return [];

  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${html}</div>`, "text/html");
  const container = doc.body.firstElementChild;

  if (!container) return [];

  return renderBlockChildren(container, styles);
}

// ---------------------------------------------------------------------------
// Block-level rendering
// ---------------------------------------------------------------------------

function renderBlockChildren(
  node: Element,
  styles: PdfStyles,
  keyPrefix = "b"
): ReactNode[] {
  const result: ReactNode[] = [];

  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i];
    const rendered = renderBlockNode(child, styles, `${keyPrefix}-${i}`);
    if (rendered !== null) {
      result.push(rendered);
    }
  }

  return result;
}

function renderBlockNode(
  node: Node,
  styles: PdfStyles,
  key: string
): ReactNode {
  // Skip bare text nodes at block level (whitespace between elements)
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent?.trim();
    if (text) {
      return createElement(Text, { key, style: styles.paragraph }, text);
    }
    return null;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  switch (tag) {
    case "p":
      return renderParagraph(el, styles, key);
    case "h1":
      return renderHeading(el, styles, "heading1", key);
    case "h2":
      return renderHeading(el, styles, "heading2", key);
    case "h3":
      return renderHeading(el, styles, "heading3", key);
    case "h4":
      return renderHeading(el, styles, "heading4", key);
    case "h5":
      return renderHeading(el, styles, "heading5", key);
    case "h6":
      return renderHeading(el, styles, "heading6", key);
    case "ul":
      return renderList(el, styles, "unordered", key);
    case "ol":
      return renderList(el, styles, "ordered", key);
    case "blockquote":
      return renderBlockquote(el, styles, key);
    case "hr":
      return renderSceneBreak(styles, key);
    case "img":
      return renderImage(el, styles, key);
    case "table":
      return renderTable(el, styles, key);
    case "section":
      if (el.classList.contains("endnotes")) {
        return renderEndnotes(el, styles, key);
      }
      return createElement(View, { key }, ...renderBlockChildren(el, styles, key));
    case "div":
      return createElement(View, { key }, ...renderBlockChildren(el, styles, key));
    case "br":
      return createElement(Text, { key }, "\n");
    default:
      // Unknown block element — try rendering children
      return createElement(View, { key }, ...renderBlockChildren(el, styles, key));
  }
}

// ---------------------------------------------------------------------------
// Specific block renderers
// ---------------------------------------------------------------------------

function renderParagraph(
  el: Element,
  styles: PdfStyles,
  key: string
): ReactNode {
  return createElement(
    Text,
    { key, style: styles.paragraph },
    ...renderInlineChildren(el, styles)
  );
}

function renderHeading(
  el: Element,
  styles: PdfStyles,
  level: "heading1" | "heading2" | "heading3" | "heading4" | "heading5" | "heading6",
  key: string
): ReactNode {
  return createElement(
    Text,
    { key, style: styles[level] },
    ...renderInlineChildren(el, styles)
  );
}

function renderList(
  el: Element,
  styles: PdfStyles,
  type: "ordered" | "unordered",
  key: string
): ReactNode {
  const items: ReactNode[] = [];
  let counter = 0;

  for (let i = 0; i < el.children.length; i++) {
    const li = el.children[i];
    if (li.tagName.toLowerCase() === "li") {
      counter++;
      const marker = type === "unordered" ? "•  " : `${counter}.  `;
      items.push(
        createElement(
          View,
          { key: `li-${i}`, style: styles.listItem },
          createElement(Text, { key: "marker", style: styles.bullet }, marker),
          createElement(
            Text,
            { key: "text", style: styles.listItemContent },
            ...renderInlineChildren(el.children[i], styles)
          )
        )
      );
    }
  }

  return createElement(View, { key, style: styles.list }, ...items);
}

function renderBlockquote(
  el: Element,
  styles: PdfStyles,
  key: string
): ReactNode {
  // Blockquote may contain <p> elements or raw text
  const children = el.querySelectorAll("p");
  if (children.length > 0) {
    const paragraphs: ReactNode[] = [];
    for (let i = 0; i < children.length; i++) {
      paragraphs.push(
        createElement(
          Text,
          { key: `bq-p-${i}`, style: styles.blockquoteText },
          ...renderInlineChildren(children[i], styles)
        )
      );
    }
    return createElement(View, { key, style: styles.blockquote }, ...paragraphs);
  }

  // Fallback: raw text content
  return createElement(
    View,
    { key, style: styles.blockquote },
    createElement(
      Text,
      { style: styles.blockquoteText },
      ...renderInlineChildren(el, styles)
    )
  );
}

function renderSceneBreak(styles: PdfStyles, key: string): ReactNode {
  return createElement(
    View,
    { key, style: styles.sceneBreak },
    createElement(Text, { style: styles.sceneBreakText }, "* * *")
  );
}

function renderImage(
  el: Element,
  styles: PdfStyles,
  key: string
): ReactNode {
  const src = el.getAttribute("src");
  if (!src) return null;

  return createElement(Image, { key, src, style: styles.image });
}

function renderTable(
  el: Element,
  styles: PdfStyles,
  key: string
): ReactNode {
  const rows: ReactNode[] = [];

  // Gather rows from <thead>, <tbody>, or directly under <table>
  const allRows = el.querySelectorAll("tr");

  for (let r = 0; r < allRows.length; r++) {
    const tr = allRows[r];
    const cells: ReactNode[] = [];

    for (let c = 0; c < tr.children.length; c++) {
      const cell = tr.children[c];
      const isHeader = cell.tagName.toLowerCase() === "th";
      const cellStyle = isHeader ? styles.tableCellHeader : styles.tableCell;
      const textStyle = isHeader
        ? [styles.tableCellText, styles.bold]
        : styles.tableCellText;

      cells.push(
        createElement(
          View,
          { key: `c-${c}`, style: cellStyle },
          createElement(
            Text,
            { style: textStyle },
            ...renderInlineChildren(cell, styles)
          )
        )
      );
    }

    rows.push(createElement(View, { key: `r-${r}`, style: styles.tableRow }, ...cells));
  }

  return createElement(View, { key, style: styles.table }, ...rows);
}

function renderEndnotes(
  el: Element,
  styles: PdfStyles,
  key: string
): ReactNode {
  const children: ReactNode[] = [];

  // Title
  const h2 = el.querySelector("h2");
  if (h2) {
    children.push(
      createElement(
        Text,
        { key: "endnotes-title", style: styles.endnotesTitle },
        h2.textContent || "Notes"
      )
    );
  }

  // Individual endnote paragraphs
  const notes = el.querySelectorAll(".endnote");
  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    children.push(
      createElement(
        Text,
        { key: `endnote-${i}`, style: styles.endnote },
        ...renderInlineChildren(note, styles)
      )
    );
  }

  return createElement(View, { key, style: styles.endnotes }, ...children);
}

// ---------------------------------------------------------------------------
// Inline rendering
// ---------------------------------------------------------------------------

function renderInlineChildren(
  node: Element,
  styles: PdfStyles
): ReactNode[] {
  const result: ReactNode[] = [];
  let keyCounter = 0;

  function nextKey() {
    return `i-${keyCounter++}`;
  }

  function processNode(n: Node) {
    if (n.nodeType === Node.TEXT_NODE) {
      const text = n.textContent || "";
      if (text) result.push(text);
      return;
    }

    if (n.nodeType !== Node.ELEMENT_NODE) return;

    const el = n as Element;
    const tag = el.tagName.toLowerCase();

    switch (tag) {
      case "strong":
      case "b":
        result.push(
          createElement(
            Text,
            { key: nextKey(), style: styles.bold },
            ...renderInlineChildren(el, styles)
          )
        );
        break;
      case "em":
      case "i":
        result.push(
          createElement(
            Text,
            { key: nextKey(), style: styles.italic },
            ...renderInlineChildren(el, styles)
          )
        );
        break;
      case "u":
        result.push(
          createElement(
            Text,
            { key: nextKey(), style: styles.underline },
            ...renderInlineChildren(el, styles)
          )
        );
        break;
      case "s":
      case "del":
        result.push(
          createElement(
            Text,
            { key: nextKey(), style: styles.strikethrough },
            ...renderInlineChildren(el, styles)
          )
        );
        break;
      case "a": {
        const href = el.getAttribute("href") || "";
        result.push(
          createElement(
            Link,
            { key: nextKey(), src: href, style: styles.link },
            ...renderInlineChildren(el, styles)
          )
        );
        break;
      }
      case "sup":
        result.push(
          createElement(
            Text,
            { key: nextKey(), style: styles.footnoteRef },
            ...renderInlineChildren(el, styles)
          )
        );
        break;
      case "sub":
        result.push(
          createElement(
            Text,
            { key: nextKey(), style: { fontSize: 8 } },
            ...renderInlineChildren(el, styles)
          )
        );
        break;
      case "mark": {
        const bgColor =
          el
            .getAttribute("style")
            ?.match(/background-color:\s*([^;]+)/)?.[1] || "#ffff00";
        result.push(
          createElement(
            Text,
            { key: nextKey(), style: { backgroundColor: bgColor.trim() } },
            ...renderInlineChildren(el, styles)
          )
        );
        break;
      }
      case "span":
        // Pass-through: process children into the SAME result array & counter
        for (let c = 0; c < el.childNodes.length; c++) {
          processNode(el.childNodes[c]);
        }
        break;
      case "br":
        result.push("\n");
        break;
      default:
        // Unknown inline element — process children into same array
        for (let c = 0; c < el.childNodes.length; c++) {
          processNode(el.childNodes[c]);
        }
        break;
    }
  }

  for (let i = 0; i < node.childNodes.length; i++) {
    processNode(node.childNodes[i]);
  }

  return result;
}
