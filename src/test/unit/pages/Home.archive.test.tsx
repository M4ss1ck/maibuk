import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildBook } from "@/test/support/fixtures";

const { mockLoadBooks, mockNavigate, mockUpdateBook, storeState } = vi.hoisted(() => ({
  mockLoadBooks: vi.fn(),
  mockNavigate: vi.fn(),
  mockUpdateBook: vi.fn(),
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
      createBook: vi.fn(),
      updateBook: mockUpdateBook,
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
    t: (key: string, options?: { count?: number; title?: string; status?: string }) =>
      ({
        "books.title": "Books",
        "books.collectionLabel": "Book projects",
        "books.actions": "Project actions",
        "books.newBook": "New Book",
        "books.importEpub": "Import EPUB",
        "books.importShort": "Import",
        "books.updated": "Updated",
        "books.noBooks": "No books",
        "books.noBooksFull": "Create your first book",
        "books.noBooksButton": "Create a book",
        "books.filterByStatus": "Filter by status",
        "books.allStatuses": "All statuses",
        "books.statusCount": `${options?.count} statuses`,
        "books.changeStatus": `Change status of ${options?.title}`,
        "books.statusChangedToast": `Set "${options?.title}" to ${options?.status}`,
        "books.noMatches": "No books match this filter",
        "books.showAllStatuses": "Show all statuses",
        "books.filterAnnouncement": `Showing ${options?.count} books`,
        "common.new": "New",
        "common.words": "words",
        "common.draft": "Draft",
        "common.in-progress": "In Progress",
        "common.completed": "Completed",
        "common.archived": "Archived",
      })[key] ?? key,
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
}));

import { Home } from "@/pages/Home";
import { DEFAULT_STATUS_FILTER } from "@/components/project/book-list-model";
import { useSettingsStore } from "@/features/settings/store";

const alpha = buildBook({ id: "alpha", title: "Alpha", status: "draft" });
const beta = buildBook({ id: "beta", title: "Beta", status: "completed" });
const gamma = buildBook({ id: "gamma", title: "Gamma", status: "archived" });

async function showArchived(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /Filter by status/i }));
  await user.click(await screen.findByRole("option", { name: /Archived/ }));
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
}

describe("Home archiving", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState.books = [alpha, beta, gamma];
    useSettingsStore.setState({ booksStatusFilter: DEFAULT_STATUS_FILTER });
  });

  it("keeps the chosen filter when the page is left and reopened", async () => {
    const user = userEvent.setup();
    const first = render(<Home />);
    await showArchived(user);
    expect(screen.getByText("Gamma")).toBeInTheDocument();

    first.unmount();
    render(<Home />);

    expect(screen.getByText("Gamma")).toBeInTheDocument();
  });

  it("hides archived books until the filter asks for them", async () => {
    const user = userEvent.setup();
    render(<Home />);

    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.queryByText("Gamma")).not.toBeInTheDocument();

    await showArchived(user);

    expect(screen.getByText("Gamma")).toBeInTheDocument();
  });

  it("archives the focused book using only the keyboard", async () => {
    const user = userEvent.setup();
    render(<Home />);

    screen.getAllByRole("row")[0].focus();
    await user.keyboard("{Tab}");

    const statusButton = screen.getByRole("button", { name: "Change status of Alpha" });
    expect(statusButton).toHaveFocus();

    await user.keyboard("{Enter}");
    await screen.findByRole("listbox");
    await user.keyboard("{End}{Enter}");

    expect(mockUpdateBook).toHaveBeenCalledWith("alpha", { status: "archived" });
  });

  it("restores an archived book back to draft", async () => {
    const user = userEvent.setup();
    useSettingsStore.setState({ booksStatusFilter: ["archived"] });
    render(<Home />);

    await user.click(screen.getByRole("button", { name: "Change status of Gamma" }));
    await user.click(await screen.findByRole("option", { name: "Draft" }));

    expect(mockUpdateBook).toHaveBeenCalledWith("gamma", { status: "draft" });
  });

  it("still opens a book with Enter on the card itself", async () => {
    const user = userEvent.setup();
    render(<Home />);

    screen.getAllByRole("row")[0].focus();
    await user.keyboard("{Enter}");

    expect(mockNavigate).toHaveBeenCalledWith("/book/alpha");
  });

  it("does not open the book when a status is picked", async () => {
    const user = userEvent.setup();
    render(<Home />);

    await user.click(screen.getByRole("button", { name: "Change status of Alpha" }));
    await user.click(await screen.findByRole("option", { name: "Completed" }));

    expect(mockUpdateBook).toHaveBeenCalledWith("alpha", { status: "completed" });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("does not update a book when its current status is picked", async () => {
    const user = userEvent.setup();
    render(<Home />);

    await user.click(screen.getByRole("button", { name: "Change status of Alpha" }));
    await user.click(await screen.findByRole("option", { name: "Draft" }));

    expect(mockUpdateBook).not.toHaveBeenCalled();
  });

  it("offers a way out when the filter matches nothing", async () => {
    const user = userEvent.setup();
    storeState.books = [gamma];
    render(<Home />);

    expect(screen.getByText("No books match this filter")).toBeInTheDocument();
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show all statuses" }));

    expect(screen.getByText("Gamma")).toBeInTheDocument();
  });

  it("keeps the untouched empty state when there are no books at all", () => {
    storeState.books = [];
    render(<Home />);

    expect(screen.getByText("No books")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Filter by status/i })).not.toBeInTheDocument();
  });
});
