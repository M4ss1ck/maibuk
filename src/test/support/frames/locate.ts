/**
 * One step of a locator chain, as the frame bench drivers build them with
 * Playwright (`getByRole`, `locator`, `getByText`, `first`, `visible`). The
 * desktop source drives the app over W3C WebDriver, which has no locators, so
 * it serializes `locateAll` into the page and runs it there. Steps are plain
 * data so they cross the WebDriver boundary as JSON.
 */
export type LocateStep =
  | {
      kind: "role";
      role: string;
      name?: string | { source: string; flags: string };
      exact?: boolean;
      selected?: boolean;
      level?: number;
    }
  | { kind: "css"; selector: string }
  | { kind: "text"; text: string; exact?: boolean }
  | { kind: "first" }
  | { kind: "visible" };

/**
 * All matches of the step chain, in document order.
 *
 * Serialized into the page with `Function.prototype.toString`: the body must
 * not reference anything outside itself (no imports, no module-level helpers;
 * every helper is defined inside it). Only browser globals are used. Bundlers
 * with `keepNames` insert `__name(...)` calls into nested functions, so a
 * caller that serializes this function must define `__name` first, for
 * example `var __name = (f) => f;`, before evaluating the source.
 */
export function locateAll(steps: LocateStep[]): Element[] {
  const norm = (s: string): string => s.replace(/\s+/g, " ").trim();
  const textOf = (el: Element): string => norm(el.textContent ?? "");

  // Explicit role (first token) wins, then the implicit role of the element.
  const roleOf = (el: Element): string | null => {
    const explicit = (el.getAttribute("role") ?? "").trim().split(/\s+/)[0];
    if (explicit) return explicit.toLowerCase();
    const tag = el.tagName.toLowerCase();
    if (tag === "button") return "button";
    if (tag === "input") {
      const type = (el.getAttribute("type") ?? "text").trim().toLowerCase();
      if (type === "button" || type === "submit" || type === "reset") return "button";
      if (type === "search") return "searchbox";
      if (type === "" || type === "text" || type === "email" || type === "tel" || type === "url") {
        return "textbox";
      }
      return null;
    }
    if (tag === "textarea") return "textbox";
    if (el.getAttribute("contenteditable") === "true") return "textbox";
    if (/^h[1-6]$/.test(tag)) return "heading";
    if (tag === "table") return "table";
    if (tag === "tr") return "row";
    if (tag === "nav") return "navigation";
    if (tag === "dialog") return "dialog";
    if (tag === "select" && el.hasAttribute("multiple")) return "listbox";
    if (tag === "hr") return "separator";
    return null;
  };

  // aria-level wins; a native h1-h6 gives its tag level; a heading without
  // either is level 2, the ARIA default.
  const levelOf = (el: Element): number | undefined => {
    const explicit = Number(el.getAttribute("aria-level"));
    if (el.getAttribute("aria-level") !== null && explicit > 0) return explicit;
    const tag = /^h([1-6])$/.exec(el.tagName.toLowerCase());
    if (tag) return Number(tag[1]);
    if (roleOf(el) === "heading") return 2;
    return undefined;
  };

  // Playwright's getByRole skips elements hidden from the accessibility tree.
  const hiddenFromTree = (el: Element): boolean => {
    for (let node: Element | null = el; node; node = node.parentElement) {
      if (node.getAttribute("aria-hidden") === "true" || node.hasAttribute("hidden")) return true;
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return true;
    }
    return false;
  };

  // Simplified accessible name: aria-labelledby, aria-label, the label or
  // placeholder of a text field, then the content of name-from-content roles.
  const CONTENT_ROLES = [
    "button",
    "row",
    "option",
    "heading",
    "link",
    "cell",
    "gridcell",
    "columnheader",
    "treeitem",
    "tab",
    "menuitem",
  ];
  const nameOf = (el: Element): string => {
    const labelledby = (el.getAttribute("aria-labelledby") ?? "").trim();
    if (labelledby) {
      const parts: string[] = [];
      for (const id of labelledby.split(/\s+/)) {
        const ref = document.getElementById(id);
        if (ref) parts.push(textOf(ref));
      }
      if (parts.length > 0) return norm(parts.join(" "));
    }
    const label = norm(el.getAttribute("aria-label") ?? "");
    if (label) return label;
    const tag = el.tagName.toLowerCase();
    if (tag === "input" || tag === "textarea") {
      for (const lab of Array.from(document.querySelectorAll("label"))) {
        if ((el.id !== "" && lab.htmlFor === el.id) || lab.contains(el)) return textOf(lab);
      }
      const placeholder = norm(el.getAttribute("placeholder") ?? "");
      if (placeholder) return placeholder;
    }
    const role = roleOf(el);
    if (role !== null && CONTENT_ROLES.indexOf(role) !== -1) return textOf(el);
    return "";
  };

  const nameMatches = (
    name: string,
    want: string | { source: string; flags: string },
    exact: boolean | undefined
  ): boolean => {
    if (typeof want === "string") {
      const wanted = norm(want);
      if (exact) return name === wanted;
      return name.toLowerCase().indexOf(wanted.toLowerCase()) !== -1;
    }
    return new RegExp(want.source, want.flags).test(name);
  };

  const roleMatches = (el: Element, step: Extract<LocateStep, { kind: "role" }>): boolean => {
    if (roleOf(el) !== step.role.trim().toLowerCase()) return false;
    if (step.level !== undefined && levelOf(el) !== step.level) return false;
    if (step.selected !== undefined) {
      const selected = el.getAttribute("aria-selected") === "true";
      if (selected !== step.selected) return false;
    }
    if (step.name !== undefined && !nameMatches(nameOf(el), step.name, step.exact)) return false;
    return !hiddenFromTree(el);
  };

  // Playwright's visible(): a non-empty box and no CSS hiding. Same rule as
  // elementVisible in e2e/frames/frame-page.ts.
  const isVisible = (el: Element): boolean => {
    // Playwright's rule: a `display: contents` element has no box of its own
    // and is visible when any child is (the palette's dialog is one).
    const style = getComputedStyle(el);
    if (style.display === "contents") return Array.from(el.children).some(isVisible);
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    return style.visibility !== "hidden" && style.display !== "none";
  };

  const inDocumentOrder = (set: Set<Element>): Element[] =>
    Array.from(set).sort((a, b) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
    );

  // Each step searches the descendants of every current match; the first
  // step searches the document. `current` stays null until a step runs.
  let current: Element[] | null = null;
  for (const step of steps) {
    if (step.kind === "first") {
      const base: Element[] = current ?? Array.from(document.querySelectorAll("*"));
      current = base.slice(0, 1);
      continue;
    }
    if (step.kind === "visible") {
      const base: Element[] = current ?? Array.from(document.querySelectorAll("*"));
      current = base.filter(isVisible);
      continue;
    }

    const scopes: ParentNode[] = current ?? [document];
    const found = new Set<Element>();
    if (step.kind === "css") {
      for (const scope of scopes) {
        for (const el of Array.from(scope.querySelectorAll(step.selector))) found.add(el);
      }
    } else if (step.kind === "role") {
      for (const scope of scopes) {
        for (const el of Array.from(scope.querySelectorAll("*"))) {
          if (roleMatches(el, step)) found.add(el);
        }
      }
    } else {
      // Text: the innermost elements whose own text matches. An element is
      // dropped when a matching descendant also matches.
      const candidates = new Set<Element>();
      for (const scope of scopes) {
        for (const el of Array.from(scope.querySelectorAll("*"))) {
          const tag = el.tagName.toLowerCase();
          if (tag === "script" || tag === "style") continue;
          const text = textOf(el);
          const wanted = norm(step.text);
          const hit = step.exact
            ? text === wanted
            : text.toLowerCase().indexOf(wanted.toLowerCase()) !== -1;
          if (hit) candidates.add(el);
        }
      }
      const list = Array.from(candidates);
      for (const el of list) {
        if (!list.some((other) => other !== el && el.contains(other))) found.add(el);
      }
    }
    current = inDocumentOrder(found);
  }
  return current ?? [];
}

/** Converts RoleOptions.name (string | RegExp) to the serializable form in LocateStep. */
export function serializableName(
  name: string | RegExp | undefined
): string | { source: string; flags: string } | undefined {
  if (name === undefined || typeof name === "string") return name;
  return { source: name.source, flags: name.flags };
}
