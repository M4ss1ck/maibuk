import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SyncControls } from "@/components/sync/SyncControls";
import { useSyncStore } from "@/features/sync/store";

vi.mock("react-i18next", () => ({
  initReactI18next: {
    type: "3rdParty",
    init: vi.fn(),
  },
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe("SyncControls", () => {
  beforeEach(() => {
    useSyncStore.setState({
      syncStatus: "idle",
      syncError: null,
      pendingDeletions: [],
      syncLog: [],
    });
  });

  it("collapses the log without clearing entries", async () => {
    const user = userEvent.setup();
    useSyncStore.setState({
      syncLog: [
        {
          id: "log-1",
          timestamp: 100,
          level: "success",
          event: "pull",
          message: "Pulled note",
        },
      ],
    });

    render(<SyncControls onSync={vi.fn()} />);

    expect(screen.getByText("Pulled note")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /sync.logTitle/ }));

    expect(screen.queryByText("Pulled note")).not.toBeInTheDocument();
    expect(useSyncStore.getState().syncLog).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: /sync.logTitle/ }));

    expect(screen.getByText("Pulled note")).toBeInTheDocument();
  });

  it("clears the log only through the explicit clear action", async () => {
    const user = userEvent.setup();
    useSyncStore.setState({
      syncLog: [
        {
          id: "log-1",
          timestamp: 100,
          level: "info",
          event: "scope",
          message: "Started sync",
        },
      ],
    });

    render(<SyncControls onSync={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "sync.clearLog" }));

    expect(useSyncStore.getState().syncLog).toEqual([]);
    expect(screen.queryByText("Started sync")).not.toBeInTheDocument();
  });
});

describe("SyncControls deletion review", () => {
  const localItem = {
    id: "book:book-1",
    entityType: "book" as const,
    entityId: "book-1",
    title: "Deleted here",
    deletedAt: 100,
  };
  const remoteItem = {
    id: "note:note-1",
    entityType: "note" as const,
    entityId: "note-1",
    title: "Deleted elsewhere",
    deletedAt: 200,
    deletedRemotely: true,
  };

  beforeEach(() => {
    useSyncStore.setState({
      syncStatus: "idle",
      syncError: null,
      pendingDeletions: [],
      syncLog: [],
    });
  });

  it("labels deletions from another device as removing this device's copy", () => {
    useSyncStore.setState({ pendingDeletions: [remoteItem] });

    render(<SyncControls onSync={vi.fn()} />);

    expect(screen.getByText("sync.remoteDeletionsTitle")).toBeInTheDocument();
    expect(screen.queryByText("sync.pendingDeletionsTitle")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "sync.confirmLocalDeletions" })).toBeInTheDocument();
  });

  it("keeps local and remote deletions apart and confirms both by keyboard", async () => {
    const user = userEvent.setup();
    const onSync = vi.fn().mockResolvedValue(undefined);
    const confirmPendingDeletions = vi.fn().mockResolvedValue(undefined);
    useSyncStore.setState({ pendingDeletions: [localItem, remoteItem], confirmPendingDeletions });

    render(<SyncControls onSync={onSync} />);

    expect(screen.getByText("sync.pendingDeletionsTitle")).toBeInTheDocument();
    expect(screen.getByText("sync.remoteDeletionsTitle")).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: "sync.confirmDeletions" });
    confirm.focus();
    await user.keyboard("{Enter}");

    expect(confirmPendingDeletions).toHaveBeenCalledWith(["book:book-1", "note:note-1"]);
    expect(onSync).toHaveBeenCalledWith({
      scope: "all",
      direction: "bidirectional",
      confirmedDeletionIds: ["book:book-1", "note:note-1"],
    });
  });
});
