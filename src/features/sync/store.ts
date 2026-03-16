import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AuthStatus, SyncStatus, SyncItemMeta, ConflictResolver, SyncOutcome } from "./types";
import {
  initClient,
  restoreAuth,
  refreshAuth as pbRefreshAuth,
  login as pbLogin,
  register as pbRegister,
  loginWithOAuth as pbLoginWithOAuth,
  logout as pbLogout,
} from "./client";
import { clearPassphrase, setPassphrase as cryptoSetPassphrase } from "./crypto";
import { syncAllBooks, syncBook } from "./sync-engine";

const STORAGE_KEY = "maibuk-sync";

interface SyncStore {
  authStatus: AuthStatus;
  userEmail: string | null;
  authToken: string | null;
  syncStatus: SyncStatus;
  lastSyncedAt: number | null;
  syncError: string | null;
  apiUrl: string;
  bookSyncMeta: Record<string, SyncItemMeta>;
  authVerified: boolean;
  passphrase: string | null;

  setApiUrl: (url: string) => void;
  setPassphrase: (passphrase: string | null) => void;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  loginWithOAuth: (provider: string) => Promise<void>;
  logout: () => void;
  verifyAuth: () => Promise<void>;
  syncAll: (passphrase: string, onConflict: ConflictResolver) => Promise<void>;
  syncSingleBook: (bookId: string, passphrase: string, onConflict: ConflictResolver) => Promise<void>;
  updateBookMeta: (bookId: string, meta: SyncItemMeta) => void;
}

function applySyncOutcome(
  outcome: SyncOutcome,
  set: (partial: Partial<SyncStore>) => void,
): void {
  if (outcome === "cancelled") {
    set({ syncStatus: "cancelled", syncError: null });
    return;
  }

  set({
    syncStatus: outcome === "partial" ? "partial" : "success",
    syncError: null,
    lastSyncedAt: Math.floor(Date.now() / 1000),
  });
}

export const useSyncStore = create<SyncStore>()(
  persist(
    (set) => ({
      authStatus: "logged-out",
      userEmail: null,
      authToken: null,
      syncStatus: "idle",
      lastSyncedAt: null,
      syncError: null,
      apiUrl: "",
      bookSyncMeta: {},
      authVerified: false,
      passphrase: null,

      setApiUrl: (apiUrl) => {
        initClient(apiUrl);
        set({ apiUrl });
      },

      setPassphrase: (passphrase) => {
        cryptoSetPassphrase(passphrase as string);
        set({ passphrase });
      },

      login: async (email, password) => {
        const result = await pbLogin(email, password);
        set({
          authStatus: "logged-in",
          userEmail: result.email,
          authToken: result.token,
          authVerified: true,
        });
      },

      register: async (email, password) => {
        const result = await pbRegister(email, password);
        set({
          authStatus: "logged-in",
          userEmail: result.email,
          authToken: result.token,
          authVerified: true,
        });
      },

      loginWithOAuth: async (provider) => {
        const result = await pbLoginWithOAuth(provider);
        set({
          authStatus: "logged-in",
          userEmail: result.email,
          authToken: result.token,
          authVerified: true,
        });
      },

      logout: () => {
        pbLogout();
        clearPassphrase();
        set({
          authStatus: "logged-out",
          userEmail: null,
          authToken: null,
          authVerified: false,
          passphrase: null,
          syncStatus: "idle",
          syncError: null,
          bookSyncMeta: {},
        });
      },

      verifyAuth: async () => {
        const { authToken, apiUrl } = useSyncStore.getState();
        if (!authToken || !apiUrl) return;
        if (!navigator.onLine) return;

        try {
          const result = await pbRefreshAuth();
          set({
            authStatus: "logged-in",
            userEmail: result.email,
            authToken: result.token,
            authVerified: true,
          });

          // Auto-sync if passphrase is available
          const { passphrase } = useSyncStore.getState();
          if (passphrase) {
            const skipConflicts: ConflictResolver = async () => "cancel";
            try {
              await useSyncStore.getState().syncAll(passphrase, skipConflicts);
            } catch {
              // syncAll already sets error status in the store
            }
          }
        } catch (error: unknown) {
          const status = (error as { status?: number }).status;
          if (status === 401) {
            set({
              authStatus: "logged-out",
              userEmail: null,
              authToken: null,
              authVerified: false,
              syncError: "sync.sessionExpired",
            });
          }
          // Network errors: keep optimistic state, authVerified stays false
        }
      },

      syncAll: async (passphrase, onConflict) => {
        set({ syncStatus: "syncing", syncError: null });
        try {
          const result = await syncAllBooks(passphrase, onConflict);
          applySyncOutcome(result.outcome, set);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Sync failed";
          set({ syncStatus: "error", syncError: message });
          throw error;
        }
      },

      syncSingleBook: async (bookId, passphrase, onConflict) => {
        set({ syncStatus: "syncing", syncError: null });
        try {
          const result = await syncBook(bookId, passphrase, onConflict);
          applySyncOutcome(result.outcome, set);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Sync failed";
          set({ syncStatus: "error", syncError: message });
          throw error;
        }
      },

      updateBookMeta: (bookId, meta) => {
        set((state) => ({
          bookSyncMeta: { ...state.bookSyncMeta, [bookId]: meta },
        }));
      },
    }),
    {
      name: STORAGE_KEY,
      partialize: (state) => ({
        authStatus: state.authStatus,
        userEmail: state.userEmail,
        authToken: state.authToken,
        lastSyncedAt: state.lastSyncedAt,
        apiUrl: state.apiUrl,
        passphrase: state.passphrase,
        bookSyncMeta: state.bookSyncMeta,
      }),
      onRehydrateStorage: () => {
        return (state) => {
          if (!state) return;

          if (state.apiUrl) {
            initClient(state.apiUrl);
          }
          if (state.passphrase) {
            cryptoSetPassphrase(state.passphrase);
          }
          if (state.authToken && state.apiUrl) {
            restoreAuth(state.authToken);
            // Fire-and-forget: validate token with server
            useSyncStore.getState().verifyAuth();
          }
        };
      },
    },
  ),
);
