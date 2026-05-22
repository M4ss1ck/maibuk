import type {
  PasteCleanupOptions,
  PasteCleanupRule,
  PasteCleanupSettings,
  PasteRuleAction,
  PasteRuleTarget,
} from "../../features/settings/types";

/**
 * Pure paste-cleanup engine. Given raw pasted HTML and the author's cleanup
 * settings, returns cleaned HTML in four stages:
 *   1. Hygiene — always on (Google Docs / Word junk, empty tags, heading levels,
 *      highlight mirroring, margin/indent normalisation)
 *   2. Category cleanup — strip the configured CSS properties + structural ops
 *   3. Custom rules — applied in array order, each guarded so a bad rule is skipped
 *   4. Bare-tag cleanup — unwrap attributeless <span>/<font> left behind
 */
export function cleanPastedHtml(
  html: string,
  settings: PasteCleanupSettings,
): string {
  if (!html) return "";

  const doc = new DOMParser().parseFromString(html, "text/html");
  const body = doc.body;

  applyHygiene(body);
  applyCategoryCleanup(body, settings.options);
  applyCustomRules(body, settings.rules);
  unwrapBareInlineTags(body);

  return body.innerHTML;
}

// --- Stage 1: hygiene (always on) -----------------------------------------

function applyHygiene(body: HTMLElement): void {
  unwrapGoogleDocsWrapper(body);
  removeComments(body);
  removeNamespacedElements(body);
  stripMsoArtifacts(body);
  cleanupSourceAttributes(body);
  removeEmptyInlineTags(body);
  normalizeHeadingLevels(body);
  mirrorHighlightColors(body);
  capParagraphMargins(body);
  normalizeIndentation(body);
}

function unwrapGoogleDocsWrapper(body: HTMLElement): void {
  for (const selector of [
    'b[id*="docs-internal-guid"]',
    'span[id*="docs-internal-guid"]',
  ]) {
    const wrapper = body.querySelector(selector);
    if (wrapper) unwrapElement(wrapper);
  }
}

function removeComments(body: HTMLElement): void {
  const iterator = body.ownerDocument.createNodeIterator(
    body,
    NodeFilter.SHOW_COMMENT,
  );
  const comments: Node[] = [];
  for (let node = iterator.nextNode(); node; node = iterator.nextNode()) {
    comments.push(node);
  }
  for (const comment of comments) comment.parentNode?.removeChild(comment);
}

function removeNamespacedElements(body: HTMLElement): void {
  for (const el of Array.from(body.querySelectorAll("*"))) {
    if (el.tagName.includes(":")) el.remove();
  }
}

function stripMsoArtifacts(body: HTMLElement): void {
  for (const el of Array.from(body.querySelectorAll<HTMLElement>("*"))) {
    const style = el.getAttribute("style");
    if (style?.toLowerCase().includes("mso-")) {
      const cleaned = style
        .split(";")
        .filter((decl) => !decl.trim().toLowerCase().startsWith("mso-"))
        .join(";")
        .trim();
      if (cleaned) el.setAttribute("style", cleaned);
      else el.removeAttribute("style");
    }
    for (const cls of Array.from(el.classList)) {
      if (/^mso/i.test(cls)) el.classList.remove(cls);
    }
    if (el.getAttribute("class") === "") el.removeAttribute("class");
  }
}

function cleanupSourceAttributes(body: HTMLElement): void {
  for (const el of Array.from(body.querySelectorAll("*"))) {
    const className = el.getAttribute("class");
    if (
      className &&
      (className.includes("docs-") || className.includes("kix-"))
    ) {
      el.removeAttribute("class");
    }
    const id = el.getAttribute("id");
    if (id && (id.includes("docs-") || id.includes("kix-"))) {
      el.removeAttribute("id");
    }
    for (const attr of Array.from(el.attributes)) {
      if (
        attr.name.startsWith("data-docs-") ||
        attr.name.startsWith("data-kix-")
      ) {
        el.removeAttribute(attr.name);
      }
    }
  }
}

function removeEmptyInlineTags(body: HTMLElement): void {
  for (const el of Array.from(body.querySelectorAll("span, font"))) {
    if (el.childNodes.length === 0) el.remove();
  }
}

function normalizeHeadingLevels(body: HTMLElement): void {
  for (const el of Array.from(body.querySelectorAll("h4, h5, h6"))) {
    renameElement(el, "h3");
  }
}

function mirrorHighlightColors(body: HTMLElement): void {
  for (const span of Array.from(body.querySelectorAll<HTMLElement>("span"))) {
    const bg = span.style.backgroundColor;
    if (bg && bg !== "transparent" && bg !== "inherit") {
      span.setAttribute("data-color", bg);
    }
  }
}

function capParagraphMargins(body: HTMLElement): void {
  for (const p of Array.from(body.querySelectorAll<HTMLElement>("p"))) {
    if (p.style.marginTop) p.style.marginTop = capMargin(p.style.marginTop);
    if (p.style.marginBottom) {
      p.style.marginBottom = capMargin(p.style.marginBottom);
    }
  }
}

function normalizeIndentation(body: HTMLElement): void {
  for (const el of Array.from(body.querySelectorAll<HTMLElement>("[style]"))) {
    if (!el.style.marginLeft && el.style.paddingLeft) {
      el.style.marginLeft = el.style.paddingLeft;
      el.style.removeProperty("padding-left");
    }
  }
}

// --- Stage 2: category cleanup --------------------------------------------

const FORMATTING_TAGS =
  "strong, b, em, i, u, s, strike, del, mark, sub, sup, code";

function applyCategoryCleanup(
  body: HTMLElement,
  options: PasteCleanupOptions,
): void {
  for (const property of options.strippedProperties) {
    removeStyleProperty(body, property);
  }
  if (options.demoteHeadings) demoteHeadings(body);
  if (options.stripLinks) unwrapAll(body, "a");
  if (options.flattenLists) flattenLists(body);
  if (options.removeImages) removeAll(body, "img");
  if (options.unwrapFormattingTags) unwrapAll(body, FORMATTING_TAGS);
}

function demoteHeadings(body: HTMLElement): void {
  for (const el of Array.from(body.querySelectorAll("h1, h2, h3"))) {
    renameElement(el, "p");
  }
}

function flattenLists(body: HTMLElement): void {
  const topLists = Array.from(body.querySelectorAll("ul, ol")).filter(
    (list) => !list.parentElement?.closest("ul, ol"),
  );
  for (const list of topLists) {
    const doc = list.ownerDocument;
    const paragraphs: HTMLElement[] = [];
    for (const li of Array.from(list.querySelectorAll("li"))) {
      const clone = li.cloneNode(true) as HTMLElement;
      for (const nested of Array.from(clone.querySelectorAll("ul, ol"))) {
        nested.remove();
      }
      const p = doc.createElement("p");
      while (clone.firstChild) p.appendChild(clone.firstChild);
      paragraphs.push(p);
    }
    list.replaceWith(...paragraphs);
  }
}

// --- Stage 3: custom rules ------------------------------------------------

function applyCustomRules(body: HTMLElement, rules: PasteCleanupRule[]): void {
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const value = rule.value.trim();
    if (!value) continue;
    try {
      const elements = matchRuleElements(body, rule.target, value);
      for (const el of elements) {
        applyRuleAction(el, rule.target, rule.action);
      }
    } catch {
      // Malformed rule (e.g. an invalid CSS selector) — skip it so a single
      // bad rule never aborts the paste.
    }
  }
}

function matchRuleElements(
  body: HTMLElement,
  target: PasteRuleTarget,
  value: string,
): Element[] {
  switch (target) {
    case "tag":
      return Array.from(body.querySelectorAll(value.toLowerCase()));
    case "cssSelector":
      return Array.from(body.querySelectorAll(value));
    case "cssClass":
      return Array.from(body.querySelectorAll("*")).filter((el) =>
        el.classList.contains(value),
      );
    case "fontFamily":
      return matchByStyle(body, "fontFamily", value);
    case "textColor":
      return matchByStyle(body, "color", value);
    case "backgroundColor":
      return matchByStyle(body, "backgroundColor", value);
    default:
      return [];
  }
}

function matchByStyle(
  body: HTMLElement,
  prop: "fontFamily" | "color" | "backgroundColor",
  value: string,
): Element[] {
  const needle = normalizeStyleValue(value);
  return Array.from(body.querySelectorAll<HTMLElement>("[style]")).filter(
    (el) => {
      const actual = normalizeStyleValue(el.style[prop]);
      return actual !== "" && actual.includes(needle);
    },
  );
}

const STYLE_TARGET_PROP: Partial<Record<PasteRuleTarget, string>> = {
  fontFamily: "font-family",
  textColor: "color",
  backgroundColor: "background-color",
};

function applyRuleAction(
  el: Element,
  target: PasteRuleTarget,
  action: PasteRuleAction,
): void {
  if (action === "delete") {
    el.remove();
    return;
  }
  if (action === "unwrap") {
    unwrapElement(el);
    return;
  }
  // removeStyle
  const styleProp = STYLE_TARGET_PROP[target];
  if (styleProp && el instanceof HTMLElement) {
    el.style.removeProperty(styleProp);
    if (!el.getAttribute("style")) el.removeAttribute("style");
  } else {
    el.removeAttribute("style");
  }
}

// --- Stage 4: bare-tag cleanup --------------------------------------------

function unwrapBareInlineTags(body: HTMLElement): void {
  for (const el of Array.from(body.querySelectorAll("span, font"))) {
    if (el.attributes.length === 0) unwrapElement(el);
  }
}

// --- Shared helpers -------------------------------------------------------

function removeStyleProperty(body: HTMLElement, prop: string): void {
  for (const el of Array.from(body.querySelectorAll<HTMLElement>("[style]"))) {
    el.style.removeProperty(prop);
    if (!el.getAttribute("style")) el.removeAttribute("style");
  }
  // Stripping a highlight also drops the mirrored data-color attribute.
  if (prop === "background-color") {
    for (const el of Array.from(body.querySelectorAll("[data-color]"))) {
      el.removeAttribute("data-color");
    }
  }
}

function unwrapAll(body: HTMLElement, selector: string): void {
  for (const el of Array.from(body.querySelectorAll(selector))) {
    unwrapElement(el);
  }
}

function removeAll(body: HTMLElement, selector: string): void {
  for (const el of Array.from(body.querySelectorAll(selector))) {
    el.remove();
  }
}

function unwrapElement(el: Element): void {
  el.replaceWith(...Array.from(el.childNodes));
}

function renameElement(el: Element, tagName: string): Element {
  const replacement = el.ownerDocument.createElement(tagName);
  for (const attr of Array.from(el.attributes)) {
    replacement.setAttribute(attr.name, attr.value);
  }
  while (el.firstChild) replacement.appendChild(el.firstChild);
  el.replaceWith(replacement);
  return replacement;
}

function capMargin(value: string): string {
  const num = Number.parseFloat(value);
  if (Number.isNaN(num)) return value;
  return num > 24 ? "24px" : value;
}

function normalizeStyleValue(value: string): string {
  return value.toLowerCase().replace(/['"\s]/g, "");
}
