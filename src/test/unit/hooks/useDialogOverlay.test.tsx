import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDialogOverlay } from "@/hooks/useDialogOverlay";

// The hook's wiring, not just the attribute helper: the page is hidden while
// the dialog is open, a portal mounted under the body is not, and closing
// releases the page. Keyboard and assistive behaviour is covered by
// Modal.test.tsx, Layout.test.tsx, and the Command Palette E2E lane.

function Harness({ initiallyOpen = false }: { initiallyOpen?: boolean }) {
  const [isOpen, setIsOpen] = useState(initiallyOpen);
  const panelRef = useRef<HTMLDivElement>(null);
  const { overlayProps, underlayProps } = useDialogOverlay({
    isOpen,
    onClose: () => setIsOpen(false),
    ref: panelRef,
    isKeyboardDismissDisabled: true,
  });

  return (
    <>
      <div data-testid="app">app</div>
      <button type="button" onClick={() => setIsOpen(true)}>
        open
      </button>
      {isOpen &&
        createPortal(
          <div {...underlayProps}>
            <div ref={panelRef} {...overlayProps} role="dialog" aria-label="Test dialog">
              <button type="button" onClick={() => setIsOpen(false)}>
                close
              </button>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

const hiddenAncestor = (element: Element) => element.closest('[aria-hidden="true"]');

describe("useDialogOverlay()", () => {
  it("hides the page while the dialog is open, and not the dialog", () => {
    render(<Harness initiallyOpen />);

    expect(hiddenAncestor(screen.getByTestId("app"))).not.toBeNull();
    expect(hiddenAncestor(screen.getByRole("dialog", { name: "Test dialog" }))).toBeNull();
  });

  it("releases the page when the dialog closes", () => {
    render(<Harness initiallyOpen />);
    const app = screen.getByTestId("app");
    const hidden = hiddenAncestor(app);
    expect(hidden).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "close" }));
    expect(screen.queryByRole("dialog", { name: "Test dialog" })).toBeNull();
    expect(hidden?.hasAttribute("aria-hidden")).toBe(false);
  });

  it("does not hide the page while closed", () => {
    render(<Harness />);

    expect(hiddenAncestor(screen.getByTestId("app"))).toBeNull();
  });
});

// WebKit restyles the whole document for any inline style write on <html>:
// 137 ms on a dense Canvas (CODING_STANDARDS.md, "Scroll lock"). The app shell
// is fixed to the viewport, so the lock runs only when the page can move.
describe("the scroll lock", () => {
  const html = document.documentElement;
  const overflow = () => html.style.overflow;

  afterEach(() => {
    Reflect.deleteProperty(html, "scrollHeight");
    Reflect.deleteProperty(html, "scrollWidth");
    vi.restoreAllMocks();
  });

  it("leaves <html> alone when the document cannot scroll", () => {
    render(<Harness initiallyOpen />);

    expect(overflow()).toBe("");
  });

  it("locks a document that overflows, and releases it on close", () => {
    Object.defineProperty(html, "scrollHeight", { configurable: true, value: 5000 });
    render(<Harness initiallyOpen />);

    expect(overflow()).toBe("hidden");

    fireEvent.click(screen.getByRole("button", { name: "close" }));

    expect(overflow()).toBe("");
  });

  it("locks a document that overflows sideways", () => {
    Object.defineProperty(html, "scrollWidth", { configurable: true, value: 5000 });
    render(<Harness initiallyOpen />);

    expect(overflow()).toBe("hidden");
  });

  it("decides once per open, so the lock cannot toggle under an open dialog", () => {
    const { rerender } = render(<Harness initiallyOpen />);

    Object.defineProperty(html, "scrollHeight", { configurable: true, value: 5000 });
    rerender(<Harness initiallyOpen />);
    expect(overflow()).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "close" }));
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    expect(overflow()).toBe("hidden");
  });

  it("reads no layout while closed", () => {
    const scrollHeight = vi.fn(() => 0);
    Object.defineProperty(html, "scrollHeight", { configurable: true, get: scrollHeight });
    const { rerender } = render(<Harness />);
    rerender(<Harness />);

    expect(scrollHeight).not.toHaveBeenCalled();
  });

  it("locks on iOS, where Safari moves a page that does not overflow", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("iPhone");
    render(<Harness initiallyOpen />);

    expect(overflow()).toBe("hidden");
  });
});
