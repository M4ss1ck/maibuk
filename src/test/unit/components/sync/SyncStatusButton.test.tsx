import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const { i18nState } = vi.hoisted(() => ({
  i18nState: { language: "en" as "en" | "es" },
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
  useSyncStore: () => ({
    authStatus: "logged-out",
    syncStatus: "idle",
    lastSyncedAt: null,
  }),
}));

vi.mock("@/features/books/store", () => ({
  useBookStore: () => ({ books: [] }),
}));

vi.mock("@/features/sync/useSyncFlow", () => ({
  useSyncFlow: () => ({
    showPassphraseDialog: false,
    closePassphraseDialog: vi.fn(),
    syncAllWithSessionPassphrase: vi.fn(),
    completePassphraseFlow: vi.fn(),
    activeConflict: null,
    resolveConflict: vi.fn(),
  }),
}));

vi.mock("@/components/sync/AuthDialog", () => ({
  AuthDialog: () => null,
}));

vi.mock("@/components/sync/SyncPanel", () => ({
  SyncPanel: () => null,
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
});
