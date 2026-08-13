import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { BookSidePanel } from "@/components/book/BookSidePanel";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "bookSidePanel.footnotes": "Footnotes",
        "bookSidePanel.notes": "Notes",
        "bookSidePanel.resize": "Resize panel",
        "common.close": "Close",
        "panes.bookSidePanel": "Book side panel",
      };
      return map[key] ?? key;
    },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("../../../../components/editor/FootnotesView", () => ({
  FootnotesView: () => <div data-testid="footnotes-view" />,
}));
vi.mock("../../../../components/book/BookNotesView", () => ({
  BookNotesView: () => <div data-testid="book-notes-view" />,
}));

const baseProps = {
  onTabChange: vi.fn(),
  onClose: vi.fn(),
  width: 280,
  onResizeStart: vi.fn(),
  chapters: [],
  currentChapterId: null,
  onSelectChapter: vi.fn(),
  notes: [],
  onCreateNote: vi.fn(),
  onOpenNote: vi.fn(),
};

describe("BookSidePanel mobile sheet", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 320 });
  });

  it("opens as an overlay sheet below md and closes on Escape, restoring focus to the trigger", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const harness = (
      <>
        <button type="button">open panel</button>
        <BookSidePanel {...baseProps} isOpen={false} activeTab="footnotes" onClose={onClose} />
      </>
    );
    const { rerender } = render(harness);

    const trigger = screen.getByRole("button", { name: "open panel" });
    trigger.focus();

    rerender(
      <>
        <button type="button">open panel</button>
        <BookSidePanel {...baseProps} isOpen activeTab="footnotes" onClose={onClose} />
      </>
    );

    expect(screen.getByTestId("book-side-panel-backdrop")).toBeInTheDocument();
    expect(screen.getByTestId("book-side-panel-backdrop").contains(document.activeElement)).toBe(
      true
    );
    expect(trigger).not.toHaveFocus();

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();

    rerender(
      <>
        <button type="button">open panel</button>
        <BookSidePanel {...baseProps} isOpen={false} activeTab="footnotes" onClose={onClose} />
      </>
    );
    expect(trigger).toHaveFocus();
  });

  it("keeps Tab inside the sheet and dismisses via the backdrop", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<BookSidePanel {...baseProps} isOpen activeTab="footnotes" onClose={onClose} />);

    const backdrop = screen.getByTestId("book-side-panel-backdrop");
    for (let i = 0; i < 6; i += 1) {
      await user.tab();
      expect(backdrop.contains(document.activeElement)).toBe(true);
    }

    await user.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it("switches between the mobile sheet and the in-flow panel when the viewport crosses md while open", async () => {
    const mediaListeners: Array<(event: MediaQueryListEvent) => void> = [];
    const matchMediaMock = vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener: (_: string, cb: (event: MediaQueryListEvent) => void) => {
        mediaListeners.push(cb);
      },
      removeEventListener: () => {},
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    vi.stubGlobal("matchMedia", matchMediaMock);

    const onClose = vi.fn();
    render(<BookSidePanel {...baseProps} isOpen activeTab="footnotes" onClose={onClose} />);

    expect(screen.getByTestId("book-side-panel-backdrop")).toBeInTheDocument();

    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
    mediaListeners[0]?.({ matches: false } as MediaQueryListEvent);
    await waitFor(() => {
      expect(screen.queryByTestId("book-side-panel-backdrop")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("complementary")).toBeInTheDocument();

    Object.defineProperty(window, "innerWidth", { configurable: true, value: 320 });
    mediaListeners[0]?.({ matches: true } as MediaQueryListEvent);
    await waitFor(() => {
      expect(screen.getByTestId("book-side-panel-backdrop")).toBeInTheDocument();
    });

    vi.unstubAllGlobals();
  });

  it("keeps the in-flow resizable panel on desktop", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
    render(<BookSidePanel {...baseProps} isOpen activeTab="footnotes" />);

    expect(screen.queryByTestId("book-side-panel-backdrop")).not.toBeInTheDocument();
    expect(screen.getByRole("complementary")).toHaveStyle({ width: "280px" });
  });
});
