import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BookSidePanel } from "@/components/book/BookSidePanel";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "bookSidePanel.footnotes": "Footnotes",
        "bookSidePanel.notes": "Notes",
        "bookSidePanel.resize": "Resize panel",
        "panes.bookSidePanel": "Book side panel",
        "common.close": "Close",
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

describe("BookSidePanel", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <BookSidePanel {...baseProps} isOpen={false} activeTab="footnotes" />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the footnotes view and marks the footnotes tab selected", () => {
    render(<BookSidePanel {...baseProps} isOpen activeTab="footnotes" />);

    expect(screen.getByTestId("footnotes-view")).toBeInTheDocument();
    expect(screen.queryByTestId("book-notes-view")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Footnotes" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });

  it("shows the notes view when the notes tab is active", () => {
    render(<BookSidePanel {...baseProps} isOpen activeTab="notes" />);

    expect(screen.getByTestId("book-notes-view")).toBeInTheDocument();
    expect(screen.queryByTestId("footnotes-view")).not.toBeInTheDocument();
  });

  it("moves focus into the panel on the active tab when it opens", async () => {
    render(<BookSidePanel {...baseProps} isOpen activeTab="notes" />);

    await waitFor(() => expect(screen.getByRole("tab", { name: "Notes" })).toHaveFocus());
  });

  it("switches tabs with arrow keys and closes via the control", async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();
    const onClose = vi.fn();
    render(
      <BookSidePanel
        {...baseProps}
        isOpen
        activeTab="notes"
        onTabChange={onTabChange}
        onClose={onClose}
      />
    );

    await waitFor(() => expect(screen.getByRole("tab", { name: "Notes" })).toHaveFocus());
    await user.keyboard("{ArrowLeft}");
    expect(onTabChange).toHaveBeenCalledWith("footnotes");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on Escape from inside the panel", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<BookSidePanel {...baseProps} isOpen activeTab="notes" onClose={onClose} />);

    await waitFor(() => expect(screen.getByRole("tab", { name: "Notes" })).toHaveFocus());
    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("applies the given width and starts a resize on the handle", () => {
    const onResizeStart = vi.fn();
    render(
      <BookSidePanel
        {...baseProps}
        isOpen
        activeTab="footnotes"
        width={360}
        onResizeStart={onResizeStart}
      />
    );

    const panel = screen.getByRole("complementary");
    expect(panel).toHaveStyle({ width: "360px" });

    const handle = panel.querySelector(".cursor-col-resize");
    expect(handle).not.toBeNull();
    fireEvent.mouseDown(handle as Element);
    expect(onResizeStart).toHaveBeenCalled();
  });

  it("resizes by keyboard arrows through a focusable separator", () => {
    const onResizeKey = vi.fn();
    render(
      <BookSidePanel {...baseProps} isOpen activeTab="footnotes" width={280} onResizeKey={onResizeKey} />
    );

    const handle = screen.getByRole("separator", { name: "Resize panel" });
    expect(handle).toHaveAttribute("aria-valuenow", "280");

    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(onResizeKey).toHaveBeenCalledWith(16);

    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(onResizeKey).toHaveBeenCalledWith(-16);
  });
});
