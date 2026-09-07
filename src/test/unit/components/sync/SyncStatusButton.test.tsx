import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { i18nState, syncState, syncFlow } = vi.hoisted(() => ({
  i18nState: { language: "en" as "en" | "es" },
  syncState: {
    authStatus: "logged-out",
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

const translations = {
  en: { "sync.syncStatus": "Sync status" },
  es: { "sync.syncStatus": "Estado de sincronización" },
} as const;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const lang = i18nState.language;
      return (translations as Record<string, Record<string, string>>)[lang]?.[key] ?? key;
    },
  }),
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

import { SyncStatusButton } from "@/components/sync/SyncStatusButton";

describe("SyncStatusButton", () => {
  beforeEach(() => {
    i18nState.language = "en";
    syncState.authStatus = "logged-out";
    syncState.syncStatus = "idle";
    syncState.lastSyncedAt = null;
    vi.clearAllMocks();
  });

  it("renders with English accessible name", () => {
    render(<SyncStatusButton />);
    expect(screen.getByRole("button", { name: "Sync status" })).toBeInTheDocument();
  });

  it("renders with Spanish accessible name", () => {
    i18nState.language = "es";
    render(<SyncStatusButton />);
    expect(screen.getByRole("button", { name: "Estado de sincronización" })).toBeInTheDocument();
  });

  it("opens the panel with Enter and closes with Escape, restoring focus to the trigger", async () => {
    syncState.authStatus = "logged-in";
    const user = userEvent.setup();
    render(<SyncStatusButton />);

    const trigger = screen.getByRole("button", { name: "Sync status" });
    trigger.focus();
    await user.keyboard("{Enter}");

    expect(screen.getByText("writer@example.com")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(screen.queryByText("writer@example.com")).not.toBeInTheDocument()
    );
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("opens the panel with Space", async () => {
    syncState.authStatus = "logged-in";
    const user = userEvent.setup();
    render(<SyncStatusButton />);

    const trigger = screen.getByRole("button", { name: "Sync status" });
    trigger.focus();
    await user.keyboard(" ");

    expect(screen.getByText("writer@example.com")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByText("writer@example.com")).not.toBeInTheDocument()
    );
  });

  it("keeps the panel open while choosing a nested sync dropdown option with the keyboard", async () => {
    syncState.authStatus = "logged-in";
    const user = userEvent.setup();
    render(<SyncStatusButton />);

    const trigger = screen.getByRole("button", { name: "Sync status" });
    trigger.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByText("writer@example.com")).toBeInTheDocument();

    const scopeSelect = screen.getByRole("button", { name: /sync\.scopeAll/ });
    scopeSelect.focus();
    await user.keyboard("{ArrowDown}");
    expect(await screen.findByRole("listbox")).toBeInTheDocument();
    expect(document.activeElement).toHaveAttribute("role", "option");

    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toHaveAttribute("role", "option");
    expect(document.activeElement).toHaveTextContent("sync.scopeBooks");

    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());

    expect(screen.getByText("writer@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sync\.scopeBooks/ })).toBeInTheDocument();
  });

  it("tabs from the trigger into the panel to sync and log out with the keyboard", async () => {
    syncState.authStatus = "logged-in";
    const user = userEvent.setup();
    render(<SyncStatusButton />);

    const trigger = screen.getByRole("button", { name: "Sync status" });
    trigger.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByText("writer@example.com")).toBeInTheDocument();

    await user.tab();
    expect(screen.getByRole("button", { name: /sync\.scopeAll/ })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: /sync\.directionBidirectional/ })).toHaveFocus();
    await user.tab();

    const syncButton = screen.getByRole("button", { name: "sync.syncAll" });
    expect(syncButton).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(syncFlow.syncAllWithSessionPassphrase).toHaveBeenCalledWith({
      scope: "all",
      direction: "bidirectional",
    });
    expect(screen.getByText("writer@example.com")).toBeInTheDocument();

    await user.tab();
    expect(screen.getByRole("button", { name: "sync.logout" })).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(syncState.logout).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByText("writer@example.com")).not.toBeInTheDocument()
    );
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("opens the auth dialog with Enter while logged out without opening the panel", async () => {
    const user = userEvent.setup();
    render(<SyncStatusButton />);

    const trigger = screen.getByRole("button", { name: "Sync status" });
    trigger.focus();
    await user.keyboard("{Enter}");

    expect(screen.getByTestId("auth-dialog-open")).toBeInTheDocument();
    expect(screen.queryByText("writer@example.com")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
