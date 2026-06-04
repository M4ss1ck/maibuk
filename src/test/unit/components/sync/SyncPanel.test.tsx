import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SyncPanel } from "../../../../components/sync/SyncPanel";
import { useSyncStore } from "../../../../features/sync/store";

vi.mock("react-i18next", () => ({
  initReactI18next: {
    type: "3rdParty",
    init: vi.fn(),
  },
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) =>
      values?.email ? `${key} ${values.email}` : key,
  }),
}));

describe("SyncPanel", () => {
  beforeEach(() => {
    useSyncStore.setState({
      userEmail: "writer@example.com",
      lastSyncedAt: null,
      syncError: null,
      syncStatus: "idle",
      pendingDeletions: [],
      syncLog: [],
    });
  });

  it("stays open when selecting a sync dropdown option", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<SyncPanel onClose={onClose} onSync={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /sync.scopeAll/ }));
    await user.click(screen.getByRole("option", { name: "sync.scopeNotes" }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /sync.scopeNotes/ })).toBeInTheDocument();
  });
});
