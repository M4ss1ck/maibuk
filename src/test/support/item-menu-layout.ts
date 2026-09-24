import { vi } from "vitest";

/** Model browser layout in jsdom, including the desktop-only hidden ⋯ button. */
export function mockItemMenuLayout(item: Element) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement
  ) {
    if (this.matches("[data-item-actions]")) return new DOMRect();
    if (item.contains(this)) return new DOMRect(300, 200, 240, 176);
    if (this === document.body || this === document.documentElement) {
      return new DOMRect(0, 0, 1024, 768);
    }
    if (this.classList.contains("min-w-44")) return new DOMRect(0, 0, 160, 100);
    return new DOMRect();
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (
    this: HTMLElement
  ) {
    return this.classList.contains("min-w-44") ? 160 : 0;
  });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (
    this: HTMLElement
  ) {
    return this.classList.contains("min-w-44") ? 100 : 0;
  });
  vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(1024);
  vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(768);
}
