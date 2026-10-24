/**
 * Fast block extraction for the Library Search index (#639).
 *
 * `htmlToPlainText()` goes through TipTap's schema, builds a ProseMirror
 * document, and walks it. That is the right coordinate system for the editor's
 * own selection and reveal work, but the index only needs the text, and the
 * per-item fixed cost (~4.9 ms) was 80% of a full rebuild.
 *
 * This module parses the same HTML into one reused document and walks the
 * DOM directly, without a schema or a ProseMirror document. It reproduces the
 * walk `htmlToPlainText()` performs: a block separator ("\n\n") before every
 * block node but the document's first, a hard break as "\n", TipTap's inline
 * whitespace normalization, code blocks with their whitespace kept, and atoms
 * (Footnote, Scene break, image) contributing no text of their own.
 *
 * `fastHtmlBlocks()` returns null when it meets markup it cannot prove it
 * handles — a block element inside a paragraph, a figure without its caption,
 * no DOM at all. The caller then falls back to `htmlToPlainText()`.
 * `fast-extract.test.ts` holds both paths to the same lines over every node
 * type the editor schema has.
 */

const INLINE_WHITESPACE = /[ \t\r\n\u000c]+/g;
const TRAILING_WHITESPACE = /[ \t\r\n\u000c]+$/;
const LEADING_WHITESPACE = /^[ \t\r\n\u000c]/;
const NON_WHITESPACE = /[^ \t\r\n\u000c]/;
/** The whitespace-only text nodes TipTap's `elementFromString` drops. */
const REMOVED_WHITESPACE_NODE = /^(\n\s\s|\n)$/;

/** Elements ProseMirror ignores outright, content included. */
const IGNORED_TAGS = new Set(["head", "noscript", "object", "script", "style", "title"]);

/**
 * ProseMirror's own `blockTags` set. An element in it closes the current
 * inline context even when the schema has no rule for it, which is why the
 * same markup can extract one line or two depending on where it sits.
 */
const PARSE_BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "canvas",
  "dd",
  "div",
  "dl",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hgroup",
  "hr",
  "li",
  "noscript",
  "ol",
  "output",
  "p",
  "pre",
  "section",
  "table",
  "tfoot",
  "ul",
]);

/** The schema's block nodes, as tags. `div` is only a block as a Scene break. */
const BLOCK_TAGS = new Set([
  "blockquote",
  "figure",
  "h1",
  "h2",
  "h3",
  "hr",
  "li",
  "ol",
  "p",
  "pre",
  "table",
  "td",
  "th",
  "tr",
  "ul",
]);

/** Elements that close a paragraph in the HTML parser's own tree rules. */
const CLOSES_TEXTBLOCK = new Set([
  "blockquote",
  "div",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "li",
  "ol",
  "p",
  "pre",
  "table",
  "ul",
]);

const TAG = /<\/?([a-z][a-z0-9-]*)\b[^>]*>/gi;

interface WalkState {
  text: string;
  /** A block node has been emitted, so the next one starts with a separator. */
  hasBlock: boolean;
}

interface InlineRun {
  /** Something is already in this textblock: leading whitespace is kept. */
  hasContent: boolean;
  /** The last thing appended was a text node, so a trailing trim applies. */
  lastWasText: boolean;
}

/**
 * A block element inside a paragraph (or heading) makes the HTML parser
 * restructure the tree: the paragraph closes and the block moves out. The
 * fragment parser and the document parser do that in slightly different places,
 * and the oracle uses the document one, so this markup takes the oracle path.
 * The editor never stores it; a paste that slipped through still extracts
 * exactly.
 */
function restructuresTextblock(html: string): boolean {
  if (!/<(?:p|h[1-6])[\s>/]/i.test(html)) return false;
  let open = 0;
  for (const match of html.matchAll(TAG)) {
    const tag = match[1].toLowerCase();
    if (tag === "p" || tag === "h1" || tag === "h2" || tag === "h3") {
      const closing = match[0][1] === "/";
      if (closing) open = Math.max(0, open - 1);
      else open += 1;
      continue;
    }
    if (open > 0 && CLOSES_TEXTBLOCK.has(tag)) return true;
  }
  return false;
}

let sharedDocument: Document | null | undefined;

/**
 * One document per session: creating a parser per item was part of the old
 * cost. Setting `body.innerHTML` parses into the same DOM the document parser
 * builds for the editor's own (well-nested) HTML; `restructuresTextblock()`
 * sends markup where they differ to the oracle.
 */
function htmlBody(html: string): HTMLElement | null {
  if (sharedDocument === undefined) {
    if (typeof document === "undefined") sharedDocument = null;
    else {
      try {
        sharedDocument = document.implementation.createHTMLDocument("");
      } catch {
        sharedDocument = null;
      }
    }
  }
  if (!sharedDocument) return null;
  try {
    sharedDocument.body.innerHTML = html;
    return sharedDocument.body;
  } catch {
    return null;
  }
}

/**
 * Editor HTML -> its blocks, split the way `extract.ts` splits the oracle's
 * text. `null` means "not handled here": use `htmlToPlainText()` instead.
 */
export function fastHtmlBlocks(html: string | null | undefined): string[] | null {
  if (html === null || html === undefined) return [];
  if (restructuresTextblock(html)) return null;
  const body = htmlBody(html);
  if (!body) return null;
  const state: WalkState = { text: "", hasBlock: false };
  if (!walkContainer(body, state)) return null;
  return state.text.split(/\n{2,}/);
}

/** Starts a block node: a separator unless it is the document's first. */
function startBlock(state: WalkState): void {
  if (state.hasBlock) state.text += "\n\n";
  else state.hasBlock = true;
}

function isSceneBreak(element: Element): boolean {
  return element.localName === "div" && element.hasAttribute("data-scene-break");
}

function isBlockElement(element: Element): boolean {
  const tag = element.localName;
  if (tag === "div") return isSceneBreak(element);
  if (tag === "img") return element.hasAttribute("src");
  return BLOCK_TAGS.has(tag);
}

function isBreakBefore(node: Node): boolean {
  let previous = node.previousSibling;
  // TipTap's pre-pass removed these, so ProseMirror never saw them either.
  while (previous && previous.nodeType === Node.TEXT_NODE) {
    if (!REMOVED_WHITESPACE_NODE.test(previous.nodeValue ?? "")) return false;
    previous = previous.previousSibling;
  }
  return previous !== null && previous.nodeName === "BR";
}

/** One text node of a textblock, matching ProseMirror's `addTextNode`. */
function appendInlineText(value: string, node: Node, state: WalkState, run: InlineRun): void {
  let text = value.replace(INLINE_WHITESPACE, " ");
  if (LEADING_WHITESPACE.test(text)) {
    const first = !run.hasContent;
    const afterBreak = isBreakBefore(node);
    const afterSpace = run.lastWasText && TRAILING_WHITESPACE.test(state.text);
    if (first || afterBreak || afterSpace) text = text.slice(1);
  }
  if (!text) return;
  state.text += text;
  run.hasContent = true;
  run.lastWasText = true;
}

function finishInline(state: WalkState, run: InlineRun | null): void {
  if (!run?.lastWasText) return;
  // `NodeContext.finish` strips a textblock's trailing whitespace.
  state.text = state.text.replace(TRAILING_WHITESPACE, "");
}

function beginInline(state: WalkState): InlineRun {
  startBlock(state);
  return { hasContent: false, lastWasText: false };
}

/** Inline content: text, marks, hard breaks, Footnotes. */
function walkInlineChildren(parent: ParentNode, state: WalkState, run: InlineRun): boolean {
  for (let node = parent.firstChild; node; node = node.nextSibling) {
    const type = node.nodeType;
    if (type === Node.TEXT_NODE) {
      const value = node.nodeValue ?? "";
      if (REMOVED_WHITESPACE_NODE.test(value)) continue;
      appendInlineText(value, node, state, run);
      continue;
    }
    if (type === Node.COMMENT_NODE) continue;
    if (type !== Node.ELEMENT_NODE) return false;
    if (!walkInlineElement(node as Element, state, run)) return false;
  }
  return true;
}

function walkInlineElement(element: Element, state: WalkState, run: InlineRun): boolean {
  const tag = element.localName;
  if (IGNORED_TAGS.has(tag)) return true;
  if (tag === "br") {
    // The hardBreak schema node's text serializer is "\n".
    state.text += "\n";
    run.hasContent = true;
    run.lastWasText = false;
    return true;
  }
  if (tag === "sup" && element.hasAttribute("data-footnote")) {
    // An inline atom with no text serializer: it only ends the text run.
    run.hasContent = true;
    run.lastWasText = false;
    return true;
  }
  if (isBlockElement(element) || PARSE_BLOCK_TAGS.has(tag)) {
    // A block element inside a textblock splits it; not handled here.
    return false;
  }
  return walkInlineChildren(element, state, run);
}

/** A textblock: paragraph, heading, or a figure's caption. */
function walkTextblock(parent: ParentNode, state: WalkState): boolean {
  const run: InlineRun = { hasContent: false, lastWasText: false };
  if (!walkInlineChildren(parent, state, run)) return false;
  finishInline(state, run);
  return true;
}

/** A code block: ProseMirror keeps this whitespace, with CRLF normalized. */
function walkCode(parent: ParentNode, state: WalkState): boolean {
  for (let node = parent.firstChild; node; node = node.nextSibling) {
    const type = node.nodeType;
    if (type === Node.TEXT_NODE) {
      const value = node.nodeValue ?? "";
      if (REMOVED_WHITESPACE_NODE.test(value)) continue;
      state.text += value.replace(/\r\n?/g, "\n");
      continue;
    }
    if (type === Node.COMMENT_NODE) continue;
    if (type !== Node.ELEMENT_NODE) return false;
    const element = node as Element;
    const tag = element.localName;
    if (IGNORED_TAGS.has(tag)) continue;
    if (tag === "br" || isBlockElement(element) || PARSE_BLOCK_TAGS.has(tag)) return false;
    if (!walkCode(element, state)) return false;
  }
  return true;
}

function walkFigure(element: Element, state: WalkState): boolean {
  if (!element.querySelector("img")) return false;
  const caption = element.querySelector("figcaption");
  if (!caption) return false;
  return walkTextblock(caption, state);
}

function walkBlock(element: Element, state: WalkState): boolean {
  const tag = element.localName;
  startBlock(state);
  if (tag === "p" || tag === "h1" || tag === "h2" || tag === "h3") {
    return walkTextblock(element, state);
  }
  if (tag === "pre") return walkCode(element, state);
  if (tag === "figure") return walkFigure(element, state);
  if (tag === "hr" || tag === "img") return true;
  if (tag === "div") return true; // Scene break: an atom, no text of its own.
  // blockquote, ul, ol, li, td, th, table, tr: a block container.
  return walkContainer(element, state);
}

/**
 * A sequence of block nodes, plus the implicit paragraphs ProseMirror creates
 * when inline content sits between them (a bare `li`, stray text, an unknown
 * element).
 */
function walkContainer(parent: ParentNode, state: WalkState): boolean {
  let run: InlineRun | null = null;
  for (let node = parent.firstChild; node; node = node.nextSibling) {
    const type = node.nodeType;
    if (type === Node.TEXT_NODE) {
      const value = node.nodeValue ?? "";
      if (REMOVED_WHITESPACE_NODE.test(value)) continue;
      if (!NON_WHITESPACE.test(value)) continue;
      run ??= beginInline(state);
      appendInlineText(value, node, state, run);
      continue;
    }
    if (type === Node.COMMENT_NODE) continue;
    if (type !== Node.ELEMENT_NODE) return false;
    const element = node as Element;
    const tag = element.localName;
    if (IGNORED_TAGS.has(tag)) continue;
    if (isBlockElement(element)) {
      finishInline(state, run);
      run = null;
      if (!walkBlock(element, state)) return false;
      continue;
    }
    if (PARSE_BLOCK_TAGS.has(tag)) {
      // An unmatched block element: it ends the inline run, its content is
      // parsed in the block context. No node of its own, so no separator.
      finishInline(state, run);
      run = null;
      if (!walkContainer(element, state)) return false;
      continue;
    }
    // An unmatched inline element is unwrapped into whatever context is open.
    if (run) {
      if (!walkInlineElement(element, state, run)) return false;
    } else if (!walkContainer(element, state)) {
      return false;
    }
  }
  finishInline(state, run);
  return true;
}
