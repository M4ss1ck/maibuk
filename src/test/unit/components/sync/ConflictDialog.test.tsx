import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConflictDialog } from "@/components/sync/ConflictDialog";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key }),
}));

const conflict = {
  entityType: "note" as const,
  entityId: "note-1",
  entityTitle: "My Note",
  bookId: "note-1",
  bookTitle: "My Note",
  localUpdatedAt: 1000,
  remoteUpdatedAt: 2000,
};

describe("ConflictDialog", () => {
  it("offers keep/use remote for an ordinary conflict", () => {
    render(<ConflictDialog conflict={conflict} onResolve={vi.fn()} />);

    expect(screen.getByText("sync.conflictDescription")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "sync.keepLocal" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "sync.useRemote" })).toBeInTheDocument();
  });

  it("offers restore or delete when the remote copy was deleted", async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();
    render(
      <ConflictDialog conflict={{ ...conflict, remoteDeleted: true }} onResolve={onResolve} />
    );

    expect(screen.getByText("sync.deletedConflictDescription")).toBeInTheDocument();
    expect(screen.getByText("sync.remoteDeletedAt")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "sync.useRemote" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "sync.keepAndRestore" }));
    expect(onResolve).toHaveBeenLastCalledWith("push");

    screen.getByRole("button", { name: "sync.deleteHere" }).focus();
    await user.keyboard("{Enter}");
    expect(onResolve).toHaveBeenLastCalledWith("pull");
  });

  it("cancels on Escape", async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();
    render(
      <ConflictDialog conflict={{ ...conflict, remoteDeleted: true }} onResolve={onResolve} />
    );

    await user.keyboard("{Escape}");

    expect(onResolve).toHaveBeenCalledWith("cancel");
  });
});
