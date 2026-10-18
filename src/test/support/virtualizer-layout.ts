// A React Aria Virtualizer lays rows out from its scroll view's size, which
// jsdom reports as 0, so no row would render. This shadows the two layout
// props on HTMLElement.prototype with a fixed size. Call it in beforeAll and
// call the returned function in afterAll.
const LAYOUT_PROPS = ["clientWidth", "clientHeight"] as const;

export function mockVirtualizerLayout({ height = 4000, width = 900 } = {}): () => void {
  const sizes: Record<(typeof LAYOUT_PROPS)[number], number> = {
    clientWidth: width,
    clientHeight: height,
  };
  const saved = LAYOUT_PROPS.map((name) => ({
    name,
    descriptor: Object.getOwnPropertyDescriptor(HTMLElement.prototype, name),
  }));
  Object.defineProperties(
    HTMLElement.prototype,
    Object.fromEntries(
      LAYOUT_PROPS.map((name) => [name, { configurable: true, get: () => sizes[name] }])
    )
  );
  return () => {
    for (const { name, descriptor } of saved) {
      if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
      else Reflect.deleteProperty(HTMLElement.prototype, name);
    }
  };
}

/**
 * React Aria measures each virtualized item by its scrollHeight, which jsdom
 * reports as 0. Every item would then measure 0px and the Virtualizer would
 * mount all of them. Items are the absolutely positioned wrappers (and the rows
 * inside them), so those get a fixed height. Returns the restore function.
 */
export function mockRowScrollHeight(px: number): () => void {
  const saved = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return this.getAttribute("role") === "row" || this.style.position === "absolute" ? px : 0;
    },
  });
  return () => {
    if (saved) Object.defineProperty(HTMLElement.prototype, "scrollHeight", saved);
    else Reflect.deleteProperty(HTMLElement.prototype, "scrollHeight");
  };
}

/**
 * A browser fires a `scroll` event after a script writes scrollTop, and the
 * Virtualizer only re-reads the viewport on that event. jsdom fires none, so
 * write-then-scroll would never mount the target row. Writes here dispatch the
 * event asynchronously, as a browser does. Returns the restore function.
 */
export function mockScrollEventOnScrollTopWrite(): () => void {
  const saved = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTop");
  const values = new WeakMap<HTMLElement, number>();
  Object.defineProperty(HTMLElement.prototype, "scrollTop", {
    configurable: true,
    get(this: HTMLElement) {
      return values.get(this) ?? 0;
    },
    set(this: HTMLElement, value: number) {
      values.set(this, value);
      queueMicrotask(() => this.dispatchEvent(new Event("scroll")));
    },
  });
  return () => {
    if (saved) Object.defineProperty(HTMLElement.prototype, "scrollTop", saved);
    else Reflect.deleteProperty(HTMLElement.prototype, "scrollTop");
  };
}
