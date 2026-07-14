import { render } from "@testing-library/react";
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

  function Harness({ initialOpen = true }: { initialOpen?: boolean }) {
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
          onUpdateBookInfo={vi.fn()}
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
});
