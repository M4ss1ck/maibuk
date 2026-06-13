import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BookSidePanel } from "../../../../components/book/BookSidePanel";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "bookSidePanel.footnotes": "Footnotes",
        "bookSidePanel.notes": "Notes",
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
      <BookSidePanel {...baseProps} isOpen={false} activeTab="footnotes" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the footnotes view and marks the footnotes tab active", () => {
    render(<BookSidePanel {...baseProps} isOpen activeTab="footnotes" />);

    expect(screen.getByTestId("footnotes-view")).toBeInTheDocument();
    expect(screen.queryByTestId("book-notes-view")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Footnotes" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("shows the notes view when the notes tab is active", () => {
    render(<BookSidePanel {...baseProps} isOpen activeTab="notes" />);

    expect(screen.getByTestId("book-notes-view")).toBeInTheDocument();
    expect(screen.queryByTestId("footnotes-view")).not.toBeInTheDocument();
  });

  it("switches tabs and closes via the controls", () => {
    const onTabChange = vi.fn();
    const onClose = vi.fn();
    render(
      <BookSidePanel
        {...baseProps}
        isOpen
        activeTab="footnotes"
        onTabChange={onTabChange}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Notes" }));
    expect(onTabChange).toHaveBeenCalledWith("notes");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});
