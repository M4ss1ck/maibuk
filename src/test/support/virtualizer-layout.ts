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
      LAYOUT_PROPS.map((name) => [
        name,
        { configurable: true, get: () => sizes[name] },
      ])
    )
  );
  return () => {
    for (const { name, descriptor } of saved) {
      if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
      else Reflect.deleteProperty(HTMLElement.prototype, name);
    }
  };
}
