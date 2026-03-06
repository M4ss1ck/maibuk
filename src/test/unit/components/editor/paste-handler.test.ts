import { describe, expect, it } from "vitest";

/**
 * Tests for the pure HTML-transform functions used by the PasteHandler extension.
 *
 * The PasteHandler's transformPastedHTML hook runs several DOM-based transforms.
 * Since the functions are private to the extension, we replicate the key logic
 * and test through the same DOMParser-based approach.
 */

// --- Helpers replicated from PasteHandler.ts ---

function unwrapGoogleDocsWrapper(container: HTMLElement): void {
  const wrapper = container.querySelector('b[id*="docs-internal-guid"]');
  if (wrapper && wrapper.parentElement) {
    const parent = wrapper.parentElement;
    while (wrapper.firstChild) {
      parent.insertBefore(wrapper.firstChild, wrapper);
    }
    wrapper.remove();
  }

  const spanWrapper = container.querySelector(
    'span[id*="docs-internal-guid"]',
  );
  if (spanWrapper && spanWrapper.parentElement) {
    const parent = spanWrapper.parentElement;
    while (spanWrapper.firstChild) {
      parent.insertBefore(spanWrapper.firstChild, spanWrapper);
    }
    spanWrapper.remove();
  }
}

function cleanupGoogleDocsAttributes(element: HTMLElement): void {
  const attributesToRemove = [
    "id",
    "class",
    "data-docs-internal-guid",
    "dir",
    "role",
  ];

  attributesToRemove.forEach((attr) => {
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
      if (attr.startsWith("data-docs")) {
        element.removeAttribute(attr);
      }
    }
  });

  Array.from(element.attributes).forEach((attr) => {
    if (
      attr.name.startsWith("data-docs-") ||
      attr.name.startsWith("data-kix-")
    ) {
      element.removeAttribute(attr.name);
    }
  });
}

function transformHighlight(element: HTMLElement): void {
  const bgColor = element.style.backgroundColor;
  if (bgColor && bgColor !== "transparent" && bgColor !== "inherit") {
    if (element.tagName.toLowerCase() === "span") {
      element.setAttribute("data-color", bgColor);
      element.style.backgroundColor = bgColor;
    }
  }
}

function transformParagraphSpacing(element: HTMLElement): void {
  if (element.tagName.toLowerCase() === "p") {
    const marginTop = element.style.marginTop;
    const marginBottom = element.style.marginBottom;

    const normalizeMargin = (margin: string): string => {
      if (!margin) return "";
      const value = parseFloat(margin);
      if (isNaN(value)) return margin;
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
}

// --- Tests ---

function parseHtml(html: string): HTMLElement {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.body;
}

describe("unwrapGoogleDocsWrapper()", () => {
  it("unwraps a <b> with docs-internal-guid id", () => {
    const body = parseHtml(
      '<b id="docs-internal-guid-abc123"><p>Hello</p><p>World</p></b>',
    );

    unwrapGoogleDocsWrapper(body);

    expect(body.querySelector("b")).toBeNull();
    expect(body.querySelectorAll("p")).toHaveLength(2);
    expect(body.textContent).toContain("Hello");
    expect(body.textContent).toContain("World");
  });

  it("unwraps a <span> with docs-internal-guid id", () => {
    const body = parseHtml(
      '<span id="docs-internal-guid-xyz"><p>Content</p></span>',
    );

    unwrapGoogleDocsWrapper(body);

    expect(body.querySelector("span")).toBeNull();
    expect(body.textContent).toContain("Content");
  });

  it("does nothing when no Google Docs wrapper is present", () => {
    const body = parseHtml("<p>Normal content</p>");
    const before = body.innerHTML;

    unwrapGoogleDocsWrapper(body);

    expect(body.innerHTML).toBe(before);
  });
});

describe("cleanupGoogleDocsAttributes()", () => {
  it("removes docs- prefixed class", () => {
    const el = document.createElement("p");
    el.setAttribute("class", "docs-paragraph-style");

    cleanupGoogleDocsAttributes(el);

    expect(el.hasAttribute("class")).toBe(false);
  });

  it("removes kix- prefixed class", () => {
    const el = document.createElement("p");
    el.setAttribute("class", "kix-line-content");

    cleanupGoogleDocsAttributes(el);

    expect(el.hasAttribute("class")).toBe(false);
  });

  it("preserves non-Google classes", () => {
    const el = document.createElement("p");
    el.setAttribute("class", "my-custom-class");

    cleanupGoogleDocsAttributes(el);

    expect(el.getAttribute("class")).toBe("my-custom-class");
  });

  it("removes data-docs-* and data-kix-* attributes", () => {
    const el = document.createElement("p");
    el.setAttribute("data-docs-internal-guid", "abc");
    el.setAttribute("data-kix-id", "xyz");

    cleanupGoogleDocsAttributes(el);

    expect(el.hasAttribute("data-docs-internal-guid")).toBe(false);
    expect(el.hasAttribute("data-kix-id")).toBe(false);
  });

  it("removes docs-prefixed id but keeps regular id", () => {
    const el = document.createElement("p");
    el.setAttribute("id", "docs-something");

    cleanupGoogleDocsAttributes(el);
    expect(el.hasAttribute("id")).toBe(false);

    // Regular id preserved
    const el2 = document.createElement("p");
    el2.setAttribute("id", "my-paragraph");

    cleanupGoogleDocsAttributes(el2);
    expect(el2.getAttribute("id")).toBe("my-paragraph");
  });
});

describe("transformHighlight()", () => {
  it("sets data-color on span with background-color", () => {
    const span = document.createElement("span");
    span.style.backgroundColor = "rgb(255, 255, 0)";

    transformHighlight(span);

    expect(span.getAttribute("data-color")).toBe("rgb(255, 255, 0)");
  });

  it("ignores transparent background", () => {
    const span = document.createElement("span");
    span.style.backgroundColor = "transparent";

    transformHighlight(span);

    expect(span.hasAttribute("data-color")).toBe(false);
  });

  it("ignores non-span elements", () => {
    const p = document.createElement("p");
    p.style.backgroundColor = "yellow";

    transformHighlight(p);

    expect(p.hasAttribute("data-color")).toBe(false);
  });
});

describe("transformParagraphSpacing()", () => {
  it("caps excessive margins at 24px", () => {
    const p = document.createElement("p");
    p.style.marginTop = "100px";
    p.style.marginBottom = "50px";

    transformParagraphSpacing(p);

    expect(p.style.marginTop).toBe("24px");
    expect(p.style.marginBottom).toBe("24px");
  });

  it("preserves reasonable margins", () => {
    const p = document.createElement("p");
    p.style.marginTop = "12px";
    p.style.marginBottom = "8px";

    transformParagraphSpacing(p);

    expect(p.style.marginTop).toBe("12px");
    expect(p.style.marginBottom).toBe("8px");
  });

  it("ignores non-paragraph elements", () => {
    const div = document.createElement("div");
    div.style.marginTop = "100px";

    transformParagraphSpacing(div);

    // div is not a <p>, so no normalization happens
    expect(div.style.marginTop).toBe("100px");
  });
});
