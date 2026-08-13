import { render, screen } from "@testing-library/react";
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
  }: {
    initialOpen?: boolean;
    onUpdateBookInfo?: (input: { status?: string }) => void;
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
          onDelete={vi.fn()}
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
});
