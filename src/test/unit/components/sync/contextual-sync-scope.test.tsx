import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { syncState, syncFlow } = vi.hoisted(() => ({
  syncState: {
    authStatus: "logged-in",
    syncStatus: "idle",
    lastSyncedAt: null,
    userEmail: "writer@example.com",
    syncError: null,
    pendingDeletions: [],
    syncLog: [],
    logout: vi.fn(),
    confirmPendingDeletions: vi.fn(),
    clearSyncLog: vi.fn(),
  },
  syncFlow: {
    showPassphraseDialog: false,
    closePassphraseDialog: vi.fn(),
    syncAllWithSessionPassphrase: vi.fn(async () => true),
    completePassphraseFlow: vi.fn(),
    activeConflict: null,
    resolveConflict: vi.fn(),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

vi.mock("@/features/sync/store", () => ({
  useSyncStore: () => syncState,
}));

vi.mock("@/features/books/store", () => ({
  useBookStore: () => ({ books: [] }),
}));

vi.mock("@/features/sync/useSyncFlow", () => ({
  useSyncFlow: () => syncFlow,
}));

vi.mock("@/components/sync/AuthDialog", () => ({
  AuthDialog: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="auth-dialog-open" /> : null,
}));

vi.mock("@/components/sync/PassphraseDialog", () => ({
  PassphraseDialog: () => null,
}));

vi.mock("@/components/sync/ConflictDialog", () => ({
  ConflictDialog: () => null,
}));

import { SyncControls } from "@/components/sync/SyncControls";
import { SyncPanel } from "@/components/sync/SyncPanel";
import { SyncStatusButton } from "@/components/sync/SyncStatusButton";

describe("contextual sync scope", () => {
  beforeEach(() => {
    syncState.authStatus = "logged-in";
    syncState.syncStatus = "idle";
    syncState.pendingDeletions = [];
    syncState.syncLog = [];
    vi.clearAllMocks();
  });

  it("SyncControls opens on the contextual default scope", () => {
    render(<SyncControls onSync={vi.fn()} defaultScope="notes" />);

    expect(screen.getByRole("button", { name: /sync\.scopeNotes/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /sync\.scopeAll/ })).not.toBeInTheDocument();
  });

  it("SyncControls falls back to All without a default", () => {
    render(<SyncControls onSync={vi.fn()} />);

    expect(screen.getByRole("button", { name: /sync\.scopeAll/ })).toBeInTheDocument();
  });

  it("SyncControls lets the author change scope for that opening and syncs with it", async () => {
    const user = userEvent.setup();
    const onSync = vi.fn().mockResolvedValue(undefined);
    render(<SyncControls onSync={onSync} defaultScope="notes" />);

    await user.click(screen.getByRole("button", { name: /sync\.scopeNotes/ }));
    await user.click(screen.getByRole("option", { name: "sync.scopeBooks" }));
    await user.click(screen.getByRole("button", { name: "sync.syncAll" }));

    expect(onSync).toHaveBeenCalledWith({
      scope: "books",
      direction: "bidirectional",
    });
  });

  it("SyncPanel passes its default scope to the controls", () => {
    render(<SyncPanel onClose={vi.fn()} onSync={vi.fn()} defaultScope="canvases" />);

    expect(screen.getByRole("button", { name: /sync\.scopeCanvases/ })).toBeInTheDocument();
  });

  it("SyncStatusButton opens on the contextual default without syncing", async () => {
    const user = userEvent.setup();
    render(<SyncStatusButton defaultScope="canvases" />);

    const trigger = screen.getByRole("button", { name: "sync.syncStatus" });
    trigger.focus();
    await user.keyboard("{Enter}");

    expect(screen.getByRole("button", { name: /sync\.scopeCanvases/ })).toBeInTheDocument();
    expect(syncFlow.syncAllWithSessionPassphrase).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByText("writer@example.com")).not.toBeInTheDocument()
    );
  });

  it("SyncStatusButton resets a manual scope change when the panel reopens", async () => {
    const user = userEvent.setup();
    render(<SyncStatusButton defaultScope="notes" />);

    const trigger = screen.getByRole("button", { name: "sync.syncStatus" });
    trigger.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: /sync\.scopeNotes/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /sync\.scopeNotes/ }));
    await user.click(screen.getByRole("option", { name: "sync.scopeBooks" }));
    expect(screen.getByRole("button", { name: /sync\.scopeBooks/ })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByText("writer@example.com")).not.toBeInTheDocument()
    );

    trigger.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: /sync\.scopeNotes/ })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByText("writer@example.com")).not.toBeInTheDocument()
    );
  });

  it("SyncStatusButton dispatches the keyboard-chosen scope and direction", async () => {
    const user = userEvent.setup();
    render(<SyncStatusButton defaultScope="notes" />);

    const trigger = screen.getByRole("button", { name: "sync.syncStatus" });
    trigger.focus();
    await user.keyboard("{Enter}");

    const scopeSelect = screen.getByRole("button", { name: /sync\.scopeNotes/ });
    scopeSelect.focus();
    await user.keyboard("{ArrowDown}");
    expect(await screen.findByRole("listbox")).toBeInTheDocument();
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toHaveTextContent("sync.scopeCanvases");
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: /sync\.scopeCanvases/ })).toBeInTheDocument();

    const directionSelect = screen.getByRole("button", { name: /sync\.directionBidirectional/ });
    directionSelect.focus();
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");

    const syncButton = screen.getByRole("button", { name: "sync.syncAll" });
    syncButton.focus();
    await user.keyboard("{Enter}");

    expect(syncFlow.syncAllWithSessionPassphrase).toHaveBeenCalledWith({
      scope: "canvases",
      direction: "pull",
    });

    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByText("writer@example.com")).not.toBeInTheDocument()
    );
  });

  it("Settings controls keep All as their default", () => {
    render(<SyncControls onSync={vi.fn()} layout="settings" />);

    expect(screen.getByRole("button", { name: /sync\.scopeAll/ })).toBeInTheDocument();
  });
});
