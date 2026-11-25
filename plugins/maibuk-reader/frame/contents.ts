/**
 * The Reader Frame's Contents panel (#941): the outline tree drawn beside the
 * page, its roving-focus keyboard navigation, and the destinations its entries
 * resolve to. `entry.ts` supplies the panel, the toggle button, and the tree
 * element through accessors, plus the navigation callbacks, so the engine knows
 * nothing about the toolbar or the views beyond where a destination lands.
 *
 * A PDF's outline comes from pdf.js and its entries carry pdf.js destinations,
 * which resolve to a page through `getDestination` / `getPageIndex`. Every
 * other format's outline is `documentOutline()` over foliate's TOC, whose
 * entries carry an href the Document resolves to a section.
 *
 * Like the rest of `frame/`, this is inlined into one classic script; it may
 * import only Frame-local modules, and it imports none.
 */

/** One entry of the drawn outline: a pdf.js outline item, normalized. */
export interface OutlineItem {
  /** The entry's text, as the tree draws it. */
  title: string;
  /** Where the entry points: a pdf.js destination, or a foliate href. */
  dest: unknown;
  /** Nested entries, drawn as the item's child group. */
  items?: OutlineItem[];
}

/** One foliate TOC entry, as far as the outline reads it. */
export interface FoliateOutlineEntry {
  label?: unknown;
  href?: unknown;
  subitems?: unknown;
  items?: unknown;
}

/** One entry of a flattened outline, in draw order. */
export interface FlatOutlineEntry {
  item: OutlineItem;
}

/** The pdf.js Document, as far as destination resolution reads it. */
export interface ContentsPdfDocument {
  getDestination(name: string): Promise<unknown>;
  getPageIndex?(ref: unknown): Promise<number>;
}

/** The foliate Document, as far as an outline href resolves. */
export interface ContentsDocument {
  resolveHref?(href: string): { index?: number; anchor?: unknown } | null;
}

/** The elements, labels, and navigation `entry.ts` gives the engine. */
export interface FrameContentsDeps {
  /** The panel whose `hidden` shows and hides it. */
  panel(): HTMLElement | null;
  /** The toolbar button that toggles the panel. */
  button(): HTMLElement | null;
  /** The element the tree is drawn into. */
  tree(): HTMLElement | null;
  /** One localized label. */
  t(key: string): string;
  /** The open pdf.js Document, or null. */
  pdf(): ContentsPdfDocument | null;
  /** The open foliate Document, or null. */
  document(): ContentsDocument | null;
  /** Whether the Document is drawn in the Flowing view. */
  flowing(): boolean;
  /** Turns a page, zero-based. */
  goToPage(index: number): void;
  /** Moves the Flowing view to a section, optionally at an anchor. */
  goToFlowSection(index: number, anchor: unknown): Promise<void>;
}

/** The engine: draws the outline, toggles the panel, and navigates on activate. */
export interface FrameContents {
  /** Shows an outline (or none) and draws it. */
  show(items: OutlineItem[] | null): void;
  /** Shows or hides the panel, default toggling it. */
  toggle(open?: boolean): void;
  /** Clears the outline and the drawn tree, as opening another Document does. */
  reset(): void;
}

/**
 * Normalizes foliate's TOC into outline items: each `label` becomes the title
 * (an empty one when it is not a string), each `href` the destination, and
 * `subitems` (falling back to `items`) the nested entries.
 */
export function documentOutline(items: unknown): OutlineItem[] {
  if (!Array.isArray(items)) return [];
  return (items as unknown[]).map((entry) => {
    const source = entry as FoliateOutlineEntry;
    return {
      title: typeof source.label === "string" ? source.label : "",
      dest: source.href,
      items: documentOutline(source.subitems || source.items),
    };
  });
}

/** Every outline entry, depth-first in the order the tree draws them. */
export function flattenOutline(
  items: OutlineItem[],
  into: FlatOutlineEntry[] = []
): FlatOutlineEntry[] {
  for (const item of items) {
    into.push({ item });
    if (Array.isArray(item.items)) flattenOutline(item.items, into);
  }
  return into;
}

/**
 * The Contents engine over the panel `deps` supplies: it builds the tree once
 * per open, keeps one tree item focusable, and resolves an activated entry's
 * destination.
 */
export function createContents(deps: FrameContentsDeps): FrameContents {
  let outline: OutlineItem[] | null = null;

  function show(items: OutlineItem[] | null): void {
    outline = items;
    render();
  }

  function reset(): void {
    outline = null;
    const tree = deps.tree();
    if (tree) tree.textContent = "";
  }

  function toggle(open?: boolean): void {
    const panel = deps.panel();
    const button = deps.button();
    if (!panel) return;
    const next = typeof open === "boolean" ? open : panel.hidden;
    panel.hidden = !next;
    if (button) button.setAttribute("aria-expanded", String(next));
    if (next) {
      render();
      const first = treeItems()[0];
      if (first) first.focus();
    } else if (button) {
      button.focus();
    }
  }

  function render(): void {
    const tree = deps.tree();
    if (!tree) return;
    tree.textContent = "";
    if (!outline || outline.length === 0) {
      const empty = document.createElement("p");
      empty.textContent = deps.t("contentsEmpty");
      tree.append(empty);
      return;
    }
    tree.append(buildOutline(outline));
  }

  function buildOutline(items: OutlineItem[]): HTMLUListElement {
    const list = document.createElement("ul");
    list.setAttribute("role", "group");
    for (const item of items) {
      const li = document.createElement("li");
      li.setAttribute("role", "treeitem");
      li.tabIndex = -1;
      const title = document.createElement("span");
      title.textContent = typeof item.title === "string" ? item.title : "";
      li.append(title);
      if (Array.isArray(item.items) && item.items.length > 0) {
        li.setAttribute("aria-expanded", "true");
        li.append(buildOutline(item.items));
      }
      li.addEventListener("click", (event) => {
        if (event.target !== li && event.target !== title) return;
        void activate(item, li);
      });
      li.addEventListener("keydown", (event) => onTreeItemKey(event, li, item));
      list.append(li);
    }
    return list;
  }

  function treeItems(): HTMLElement[] {
    const tree = deps.tree();
    if (!tree) return [];
    return (Array.from(tree.querySelectorAll('[role="treeitem"]')) as HTMLElement[]).filter(
      (item) => isTreeItemVisible(item)
    );
  }

  function isTreeItemVisible(item: HTMLElement): boolean {
    const tree = deps.tree();
    let parent = item.parentElement;
    while (parent && parent !== tree) {
      if (parent.tagName === "UL" && parent.hidden) return false;
      parent = parent.parentElement;
    }
    return true;
  }

  function focusTreeItem(item: HTMLElement): void {
    for (const other of treeItems()) other.tabIndex = -1;
    item.tabIndex = 0;
    item.focus();
  }

  function onTreeItemKey(event: KeyboardEvent, item: HTMLElement, entry: OutlineItem): void {
    const items = treeItems();
    const position = items.indexOf(item);
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        event.stopPropagation();
        if (position >= 0 && position < items.length - 1) focusTreeItem(items[position + 1]);
        return;
      case "ArrowUp":
        event.preventDefault();
        event.stopPropagation();
        if (position > 0) focusTreeItem(items[position - 1]);
        return;
      case "Home":
        event.preventDefault();
        event.stopPropagation();
        if (items.length > 0) focusTreeItem(items[0]);
        return;
      case "End":
        event.preventDefault();
        event.stopPropagation();
        if (items.length > 0) focusTreeItem(items[items.length - 1]);
        return;
      case "ArrowRight": {
        event.preventDefault();
        event.stopPropagation();
        const child = item.querySelector(':scope > ul > [role="treeitem"]');
        if (item.getAttribute("aria-expanded") === "false") {
          item.setAttribute("aria-expanded", "true");
          const group = item.querySelector(":scope > ul");
          if (group) (group as HTMLElement).hidden = false;
        } else if (child) {
          focusTreeItem(child as HTMLElement);
        }
        return;
      }
      case "ArrowLeft": {
        event.preventDefault();
        event.stopPropagation();
        if (item.getAttribute("aria-expanded") === "true") {
          item.setAttribute("aria-expanded", "false");
          const group = item.querySelector(":scope > ul");
          if (group) (group as HTMLElement).hidden = true;
        } else {
          const parent = item.parentElement && item.parentElement.closest('[role="treeitem"]');
          if (parent) focusTreeItem(parent as HTMLElement);
        }
        return;
      }
      case "Enter":
      case " ":
        event.preventDefault();
        event.stopPropagation();
        if (position >= 0) void activate(entry, item);
        return;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        toggle(false);
        return;
      default:
        return;
    }
  }

  async function activate(item: OutlineItem, element: HTMLElement): Promise<void> {
    const pdf = deps.pdf();
    if (pdf) {
      const index = await resolveDestination(item.dest);
      if (index === null) return;
      deps.goToPage(index);
      element.focus();
      return;
    }
    const doc = deps.document();
    if (!doc) return;
    let target: { index?: number; anchor?: unknown } | null = null;
    try {
      target = typeof doc.resolveHref === "function" ? doc.resolveHref(String(item.dest)) : null;
    } catch {
      target = null;
    }
    if (!target || typeof target.index !== "number" || target.index < 0) return;
    const index = target.index;
    if (deps.flowing()) {
      await deps.goToFlowSection(index, target.anchor || null);
    } else {
      deps.goToPage(index);
    }
    element.focus();
  }

  async function resolveDestination(dest: unknown): Promise<number | null> {
    const pdf = deps.pdf();
    if (!pdf) return null;
    try {
      if (typeof dest === "string") {
        const resolved = await pdf.getDestination(dest);
        return resolved ? await resolveDestination(resolved) : null;
      }
      if (Array.isArray(dest) && dest.length > 0) {
        const target: unknown = dest[0];
        if (typeof target === "string") return await resolveDestination(target);
        if (target && typeof pdf.getPageIndex === "function") {
          return await pdf.getPageIndex(target);
        }
        if (typeof target === "number") return target;
      }
    } catch {
      return null;
    }
    return null;
  }

  return { show, toggle, reset };
}
