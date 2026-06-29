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
