import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookSettingsDialog } from "@/components/book/BookSettingsDialog";
import { useModalStore } from "@/components/ui/modal-store";
import { buildBook } from "@/test/support/fixtures";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe("BookSettingsDialog modal registration", () => {
  beforeEach(() => {
    useModalStore.setState({ modalIds: [], openCount: 0 });
  });

  function Harness({
    initialOpen = true,
    onUpdateBookInfo = vi.fn(),
    onDelete = vi.fn(),
  }: {
    initialOpen?: boolean;
    onUpdateBookInfo?: (input: { status?: string }) => void;
    onDelete?: () => void;
  }) {
    const [open, setOpen] = useState(initialOpen);
    return (
      <div>
        <button type="button" data-testid="trigger" onClick={() => setOpen(true)}>
          Open
        </button>
        <BookSettingsDialog
          isOpen={open}
          onClose={() => setOpen(false)}
          book={buildBook()}
          onUpdateBookInfo={onUpdateBookInfo}
          onDelete={onDelete}
        />
      </div>
    );
  }

  it("registers in the modal store when open and unregisters on close", () => {
    expect(useModalStore.getState().openCount).toBe(0);

    const { unmount } = render(<Harness initialOpen />);

    expect(useModalStore.getState().openCount).toBe(1);
    expect(useModalStore.getState().modalIds).toHaveLength(1);

    unmount();

    expect(useModalStore.getState().openCount).toBe(0);
    expect(useModalStore.getState().modalIds).toEqual([]);
  });

  it("does not register when closed", () => {
    expect(useModalStore.getState().openCount).toBe(0);

    render(<Harness initialOpen={false} />);

    expect(useModalStore.getState().openCount).toBe(0);
  });

  it("unregisters after Escape triggers close", async () => {
    const user = userEvent.setup();

    render(<Harness initialOpen />);

    expect(useModalStore.getState().openCount).toBe(1);

    await user.keyboard("{Escape}");

    expect(useModalStore.getState().openCount).toBe(0);
  });

  it("offers archived alongside the other statuses", () => {
    render(<Harness initialOpen />);

    for (const status of ["draft", "in-progress", "completed", "archived"]) {
      expect(screen.getByRole("button", { name: `common.${status}` })).toBeInTheDocument();
    }
  });

  it("groups the status buttons under their label and marks the current one pressed", async () => {
    const user = userEvent.setup();
    render(<Harness initialOpen />);

    const group = screen.getByRole("group", { name: "bookSettings.status" });
    const draft = within(group).getByRole("button", { name: "common.draft" });
    const completed = within(group).getByRole("button", { name: "common.completed" });
    expect(draft).toHaveAttribute("aria-pressed", "true");
    expect(completed).toHaveAttribute("aria-pressed", "false");

    completed.focus();
    await user.keyboard("{Enter}");

    expect(completed).toHaveAttribute("aria-pressed", "true");
    expect(draft).toHaveAttribute("aria-pressed", "false");
  });

  it("saves a book archived from the status selector", async () => {
    const user = userEvent.setup();
    const onUpdateBookInfo = vi.fn();

    render(<Harness initialOpen onUpdateBookInfo={onUpdateBookInfo} />);

    await user.click(screen.getByRole("button", { name: "common.archived" }));
    await user.click(screen.getByRole("button", { name: "common.save" }));

    expect(onUpdateBookInfo).toHaveBeenCalledWith(expect.objectContaining({ status: "archived" }));
  });

  it("expands and collapses the danger zone with the keyboard", async () => {
    const user = userEvent.setup();

    render(<Harness initialOpen />);

    const trigger = screen.getByRole("button", {
      name: "bookSettings.dangerZone",
    });
    trigger.focus();

    await user.keyboard(" ");
    expect(screen.getByRole("button", { name: "books.deleteBook" })).toBeInTheDocument();

    await user.keyboard(" ");
    expect(screen.queryByRole("button", { name: "books.deleteBook" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  describe("validation", () => {
    it("keeps an empty title from saving and puts focus on it", async () => {
      const user = userEvent.setup();
      const onUpdateBookInfo = vi.fn();
      render(<Harness initialOpen onUpdateBookInfo={onUpdateBookInfo} />);
      const title = screen.getByRole("textbox", { name: "books.bookTitle" });

      await user.clear(title);
      await user.click(screen.getByRole("button", { name: "common.save" }));

      expect(onUpdateBookInfo).not.toHaveBeenCalled();
      expect(title).toHaveAccessibleDescription("errors.titleRequired");
      expect(title).toHaveAttribute("aria-invalid", "true");
      expect(title).toHaveFocus();
    });

    it("keeps an empty Author Name from saving", async () => {
      const user = userEvent.setup();
      const onUpdateBookInfo = vi.fn();
      render(<Harness initialOpen onUpdateBookInfo={onUpdateBookInfo} />);
      const author = screen.getByRole("textbox", { name: "books.authorName" });

      await user.clear(author);
      await user.click(screen.getByRole("button", { name: "common.save" }));

      expect(onUpdateBookInfo).not.toHaveBeenCalled();
      expect(author).toHaveAccessibleDescription("errors.authorNameRequired");
      expect(author).toHaveFocus();
    });

    it("refuses a negative Target Word Count", async () => {
      const user = userEvent.setup();
      const onUpdateBookInfo = vi.fn();
      render(<Harness initialOpen onUpdateBookInfo={onUpdateBookInfo} />);
      const target = screen.getByRole("spinbutton", { name: "books.targetWordCount" });

      await user.type(target, "-5");
      await user.click(screen.getByRole("button", { name: "common.save" }));

      expect(onUpdateBookInfo).not.toHaveBeenCalled();
      expect(target).toHaveAccessibleDescription("errors.targetWordCountInvalid");
      expect(target).toHaveFocus();
    });

    it("Enter in a field never presses Cancel or the delete confirmation", async () => {
      const user = userEvent.setup();
      const onUpdateBookInfo = vi.fn();
      const onDelete = vi.fn();
      render(<Harness initialOpen onUpdateBookInfo={onUpdateBookInfo} onDelete={onDelete} />);
      screen.getByRole("button", { name: "bookSettings.dangerZone" }).focus();
      await user.keyboard(" ");
      screen.getByRole("button", { name: "books.deleteBook" }).focus();
      await user.keyboard("{Enter}");

      const genre = screen.getByRole("textbox", { name: "books.genre" });
      await user.type(genre, "Saga{Enter}");

      expect(onDelete).not.toHaveBeenCalled();
      expect(onUpdateBookInfo).toHaveBeenCalledWith(expect.objectContaining({ genre: "Saga" }));
    });

    it("saves with Enter from a text field", async () => {
      const user = userEvent.setup();
      const onUpdateBookInfo = vi.fn();
      render(<Harness initialOpen onUpdateBookInfo={onUpdateBookInfo} />);
      const target = screen.getByRole("spinbutton", { name: "books.targetWordCount" });

      await user.type(target, "80000{Enter}");

      expect(onUpdateBookInfo).toHaveBeenCalledWith(
        expect.objectContaining({ targetWordCount: 80000 })
      );
    });
  });

  it("moves focus to the safe choice when deleting asks for confirmation, and back on cancel", async () => {
    const user = userEvent.setup();
    render(<Harness initialOpen />);

    screen.getByRole("button", { name: "bookSettings.dangerZone" }).focus();
    await user.keyboard(" ");
    const deleteButton = screen.getByRole("button", { name: "books.deleteBook" });
    deleteButton.focus();
    await user.keyboard("{Enter}");

    const confirm = screen.getByRole("group", { name: "bookSettings.deleteConfirmMessage" });
    expect(within(confirm).getByRole("button", { name: "common.cancel" })).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: "books.deleteBook" })).toHaveFocus();
  });

  it("caps the panel with dynamic viewport height while keeping the vh fallback", () => {
    render(<Harness initialOpen />);

    const panel = document.querySelector(".max-h-\\[90vh\\]") as HTMLElement;
    expect(panel).not.toBeNull();
    expect(panel.style.maxHeight).toBe("90dvh");
  });

  it("stacks the genre/language grid on narrow viewports so the Select cannot overflow", () => {
    render(<Harness initialOpen />);

    const grid = screen.getByTestId("book-settings-genre-grid");
    expect(grid).toHaveClass("grid-cols-1", "sm:grid-cols-2");
  });
});
