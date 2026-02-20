import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AuthStatus, SyncStatus, SyncItemMeta } from "./types";
import {
  initClient,
  restoreAuth,
  login as pbLogin,
  register as pbRegister,
  loginWithOAuth as pbLoginWithOAuth,
  logout as pbLogout,
  isAuthenticated,
} from "./client";
import { clearPassphrase } from "./crypto";
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

  setApiUrl: (url: string) => void;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  loginWithOAuth: (provider: string) => Promise<void>;
  logout: () => void;
  syncAll: (passphrase: string) => Promise<void>;
  syncSingleBook: (bookId: string, passphrase: string) => Promise<void>;
  updateBookMeta: (bookId: string, meta: SyncItemMeta) => void;
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

      setApiUrl: (apiUrl) => {
        initClient(apiUrl);
        set({ apiUrl });
      },

      login: async (email, password) => {
        const result = await pbLogin(email, password);
        set({
          authStatus: "logged-in",
          userEmail: result.email,
          authToken: result.token,
        });
      },

      register: async (email, password) => {
        const result = await pbRegister(email, password);
        set({
          authStatus: "logged-in",
          userEmail: result.email,
          authToken: result.token,
        });
      },

      loginWithOAuth: async (provider) => {
        const result = await pbLoginWithOAuth(provider);
        set({
          authStatus: "logged-in",
          userEmail: result.email,
          authToken: result.token,
        });
      },

      logout: () => {
        pbLogout();
        clearPassphrase();
        set({
          authStatus: "logged-out",
          userEmail: null,
          authToken: null,
          syncStatus: "idle",
          syncError: null,
          bookSyncMeta: {},
        });
      },

      syncAll: async (passphrase) => {
        set({ syncStatus: "syncing", syncError: null });
        try {
          await syncAllBooks(passphrase);
          const now = Math.floor(Date.now() / 1000);
          set({ syncStatus: "success", lastSyncedAt: now });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Sync failed";
          set({ syncStatus: "error", syncError: message });
          throw error;
        }
      },

      syncSingleBook: async (bookId, passphrase) => {
        set({ syncStatus: "syncing", syncError: null });
        try {
          await syncBook(bookId, passphrase);
          const now = Math.floor(Date.now() / 1000);
          set({ syncStatus: "success", lastSyncedAt: now });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Sync failed";
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
        bookSyncMeta: state.bookSyncMeta,
      }),
      onRehydrateStorage: () => {
        return (state) => {
          if (!state) return;

          // Restore PocketBase client and auth on rehydration
          if (state.apiUrl) {
            initClient(state.apiUrl);
          }
          if (state.authToken && state.apiUrl) {
            try {
              restoreAuth(state.authToken);
              // Verify token is still valid
              if (!isAuthenticated()) {
                useSyncStore.setState({
                  authStatus: "logged-out",
                  userEmail: null,
                  authToken: null,
                });
              }
            } catch {
              useSyncStore.setState({
                authStatus: "logged-out",
                userEmail: null,
                authToken: null,
              });
            }
          }
        };
      },
    },
  ),
);
