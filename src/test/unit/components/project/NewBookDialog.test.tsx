import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "books.newBook": "New Book",
        "books.bookTitle": "Book Title",
        "books.authorName": "Author Name",
        "books.createBook": "Create Book",
        "common.cancel": "Cancel",
        "errors.titleRequired": "Title is required",
        "errors.authorNameRequired": "Author name is required",
      })[key] ?? key,
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
}));

const { createBook } = vi.hoisted(() => ({ createBook: vi.fn() }));
vi.mock("@/features/books/store", () => ({
  useBookStore: (selector: (state: { createBook: typeof createBook }) => unknown) =>
    selector({ createBook }),
}));

import { NewBookDialog } from "@/components/project/NewBookDialog";

function renderDialog() {
  const onSuccess = vi.fn();
  render(<NewBookDialog isOpen onClose={vi.fn()} onSuccess={onSuccess} />);
  return {
    onSuccess,
    title: screen.getByRole("textbox", { name: "Book Title" }),
    author: screen.getByRole("textbox", { name: "Author Name" }),
  };
}

// Enter inside a field submits through the footer button's `form` attribute.
// user-event only looks for submit buttons inside the <form>, so Enter-in-field
// submission is proven in real browsers by e2e/specs/books-create.spec.ts;
// here the keyboard reaches the Create Book button with Tab.
describe("NewBookDialog validation", () => {
  beforeEach(() => {
    createBook.mockReset();
  });

  it("makes Create Book the form's submit button", () => {
    renderDialog();
    const create = screen.getByRole("button", { name: "Create Book" });
    const form = screen.getByRole("textbox", { name: "Book Title" }).closest("form");
    expect(create).toHaveAttribute("type", "submit");
    expect((create as HTMLButtonElement).form).toBe(form);
  });

  it("moves focus back to the empty title when Create Book is pressed", async () => {
    const user = userEvent.setup();
    const { title } = renderDialog();

    await user.keyboard("{Tab}{Tab}{Tab}{Enter}");

    expect(title).toHaveAccessibleDescription("Title is required");
    expect(title).toHaveFocus();
    expect(createBook).not.toHaveBeenCalled();
  });

  it("moves focus to Author Name when only the author is missing", async () => {
    const user = userEvent.setup();
    const { author } = renderDialog();

    await user.keyboard("Dune{Tab}{Tab}{Tab}{Enter}");

    expect(author).toHaveAccessibleDescription("Author name is required");
    expect(author).toHaveFocus();
    expect(createBook).not.toHaveBeenCalled();
  });

  it("creates the Book once both fields are filled", async () => {
    createBook.mockResolvedValue({ id: "book-1" });
    const user = userEvent.setup();
    const { onSuccess } = renderDialog();

    await user.keyboard("Dune{Tab}Frank Herbert{Tab}{Tab}{Enter}");

    expect(createBook).toHaveBeenCalledWith({ title: "Dune", authorName: "Frank Herbert" });
    expect(onSuccess).toHaveBeenCalledWith("book-1");
  });
});
