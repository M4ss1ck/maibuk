import { render, screen, waitFor, within } from "@testing-library/react";
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
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "books.title": "Books",
        "books.collectionLabel": "Book projects",
        "books.actions": "Project actions",
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

  it("enters the book grid with an arrow key before anything has been tabbed to", async () => {
    const user = userEvent.setup();
    render(<Home />);

    expect(document.body).toHaveFocus();
    await user.keyboard("{ArrowDown}");

    expect(screen.getAllByRole("row")[0]).toHaveFocus();
  });

  it("moves horizontally through project actions", async () => {
    const user = userEvent.setup();
    render(<Home />);
    const importButton = screen.getByRole("button", { name: /Import EPUB/i });
    const newBookButton = screen.getByRole("button", { name: /New Book/i });

    importButton.focus();
    await user.keyboard("{ArrowRight}");
    expect(newBookButton).toHaveFocus();

    await user.keyboard("{ArrowLeft}");
    expect(importButton).toHaveFocus();
  });

  it("moves down from project actions into the book grid", async () => {
    const user = userEvent.setup();
    render(<Home />);
    const importButton = screen.getByRole("button", { name: /Import EPUB/i });

    importButton.focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getAllByRole("row")[0]).toHaveFocus();
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

  it("separates the page scroll owner from the responsive query container", () => {
    const { container } = render(<Home />);

    const scrollOwner = container.firstElementChild;
    expect(scrollOwner).toHaveClass(
      "h-full",
      "min-h-0",
      "overflow-x-hidden",
      "overflow-y-auto"
    );
    expect(scrollOwner).not.toHaveClass("@container", "overflow-auto");

    const queryContainer = scrollOwner?.firstElementChild;
    expect(queryContainer).toHaveClass("@container", "min-h-full");
    expect(queryContainer).not.toHaveClass("overflow-auto", "overflow-y-auto");
  });

  it("lays the book grid out with container variants instead of viewport ones", () => {
    render(<Home />);

    const grid = screen.getByRole("grid");
    expect(grid).toHaveClass("grid-cols-2", "@3xl:grid-cols-3", "@5xl:grid-cols-4");
    expect(grid).not.toHaveClass("lg:grid-cols-3", "xl:grid-cols-4");
  });

  it("keeps short localized labels so action names survive label collapse", () => {
    render(<Home />);

    const newBookButton = screen.getByRole("button", { name: /New Book/i });
    expect(within(newBookButton).getByText("New Book")).toHaveClass("hidden", "@xl:inline");
    expect(within(newBookButton).getByText("New")).toHaveClass("@xl:hidden");

    const importButton = screen.getByRole("button", { name: /Import EPUB/i });
    expect(within(importButton).getByText("Import EPUB")).toHaveClass("hidden", "@xl:inline");
    expect(within(importButton).getByText("Import")).toHaveClass("@xl:hidden");
  });
});
