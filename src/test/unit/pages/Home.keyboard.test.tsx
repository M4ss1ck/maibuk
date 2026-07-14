import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildBook } from "@/test/support/fixtures";

const { mockCreateBook, mockLoadBooks, mockNavigate, storeState } = vi.hoisted(() => ({
  mockCreateBook: vi.fn(),
  mockLoadBooks: vi.fn(),
  mockNavigate: vi.fn(),
  storeState: { books: [] as ReturnType<typeof buildBook>[] },
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock("@/features/books/store", () => ({
  useBookStore: (selector?: (state: Record<string, unknown>) => unknown) => {
    const state = {
      books: storeState.books,
      isLoading: false,
      loadBooks: mockLoadBooks,
      createBook: mockCreateBook,
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock("@/lib/platform", () => ({
  IS_WEB: false,
  isMac: () => false,
  getDialog: vi.fn(),
  getFileSystem: vi.fn(),
  getWebDialog: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "books.title": "Books",
        "books.collectionLabel": "Book projects",
        "books.newBook": "New Book",
        "books.createBook": "Create Book",
        "books.bookTitle": "Book title",
        "books.bookTitlePlaceholder": "Title",
        "books.authorName": "Author name",
        "books.authorNamePlaceholder": "Author",
        "books.importEpub": "Import EPUB",
        "books.importShort": "Import",
        "books.updated": "Updated",
        "books.noBooks": "No books",
        "books.noBooksFull": "Create your first book",
        "books.noBooksButton": "Create a book",
        "common.new": "New",
        "common.cancel": "Cancel",
        "common.close": "Close",
        "common.words": "words",
        "common.draft": "Draft",
        "settings.light": "Light",
        "settings.dark": "Dark",
        "settings.system": "System",
      })[key] ?? key,
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
}));

import { Home } from "@/pages/Home";

const books = [
  buildBook({ id: "alpha", title: "Alpha", authorName: "A" }),
  buildBook({ id: "beta", title: "Beta", authorName: "B" }),
  buildBook({ id: "gamma", title: "Gamma", authorName: "C" }),
];

describe("Home keyboard navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState.books = books;
  });

  it("renders an h1 with data-route-heading containing the page title", () => {
    render(<Home />);

    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveAttribute("data-route-heading");
    expect(h1).toHaveTextContent("Books");
  });

  it("moves real row focus with arrows, Home, End, and title typeahead", async () => {
    const user = userEvent.setup();
    render(<Home />);
    const rows = screen.getAllByRole("row");

    rows[0].focus();
    await user.keyboard("{ArrowRight}");
    expect(rows[1]).toHaveFocus();
    expect(rows[1]).toHaveClass("ring-2");
    expect(rows[0]).not.toHaveClass("ring-2");

    await user.keyboard("{ArrowLeft}");
    expect(rows[0]).toHaveFocus();

    await user.keyboard("{End}");
    expect(rows[2]).toHaveFocus();

    await user.keyboard("{Home}");
    expect(rows[0]).toHaveFocus();

    await user.keyboard("gam");
    expect(rows[2]).toHaveFocus();
  });

  it("navigates from a focused card with Enter and Space", async () => {
    const user = userEvent.setup();
    render(<Home />);
    const rows = screen.getAllByRole("row");

    rows[1].focus();
    await user.keyboard("{Enter}");
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith("/book/beta");

    mockNavigate.mockClear();
    rows[2].focus();
    await user.keyboard(" ");
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith("/book/gamma");

    mockNavigate.mockClear();
    await user.click(rows[0]);
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith("/book/alpha");
  });

  it("focuses cards with j, k, and digits but suppresses them in typing targets", async () => {
    const user = userEvent.setup();
    render(<Home />);
    const rows = screen.getAllByRole("row");

    rows[0].focus();
    await user.keyboard("j");
    expect(rows[1]).toHaveFocus();
    await user.keyboard("k");
    expect(rows[0]).toHaveFocus();
    await user.keyboard("3");
    expect(rows[2]).toHaveFocus();

    await user.click(screen.getByRole("button", { name: /New Book/i }));
    const titleInput = await screen.findByPlaceholderText("Title");
    await user.keyboard("2j");
    expect(titleInput).toHaveFocus();
  });

  it("moves focus to a remaining card when the focused book is removed", async () => {
    const { rerender } = render(<Home />);
    screen.getAllByRole("row")[1].focus();

    storeState.books = [books[0], books[2]];
    rerender(<Home />);

    await waitFor(() => expect(screen.getAllByRole("row")[1]).toHaveFocus());
  });

  it("opens New Book by keyboard and restores focus after Escape", async () => {
    const user = userEvent.setup();
    render(<Home />);
    const trigger = screen.getByRole("button", { name: /New Book/i });

    trigger.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("dialog", { name: "New Book" })).toBeInTheDocument();
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("preserves the empty state", () => {
    storeState.books = [];
    render(<Home />);

    expect(screen.getByText("No books")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create a book/ })).toBeInTheDocument();
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  });
});
