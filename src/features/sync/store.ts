import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  AuthStatus,
  SyncStatus,
  SyncItemMeta,
  ConflictResolver,
  SyncOutcome,
  SyncOptions,
  SyncLogEntry,
  SyncDeletionReviewItem,
} from "@/features/sync/types";
import {
  initClient,
  normalizeServerUrl,
  restoreAuth,
  refreshAuth as pbRefreshAuth,
  login as pbLogin,
  register as pbRegister,
  loginWithOAuth as pbLoginWithOAuth,
  logout as pbLogout,
} from "@/features/sync/client";
import { clearPassphrase, setPassphrase as cryptoSetPassphrase } from "@/features/sync/crypto";
import {
  syncAllBooks,
  syncBook,
  syncSingleNote as engineSyncSingleNote,
} from "@/features/sync/sync-engine";
import { confirmTombstones } from "@/features/sync/tombstones";
import { shouldRefreshAuth } from "@/features/sync/auth-policy";

export type SessionRefreshResult = "refreshed" | "skipped" | "offline" | "expired" | "failed";

const STORAGE_KEY = "maibuk-sync";
const MAX_SYNC_LOG_ENTRIES = 100;

// Store-requested syncs run serialized in the engine, so several store
// actions can be in flight at once. This count keeps syncStatus at
// "syncing" until the last pending operation settles — an earlier
// completion or error must not mark a still-running sync as done.
let pendingSyncCount = 0;

export function resetSyncStoreConcurrencyForTests(): void {
  pendingSyncCount = 0;
}

type SyncStoreSetter = (partial: Partial<SyncStore>) => void;

function beginStoreSync(set: SyncStoreSetter): void {
  pendingSyncCount += 1;
  set({ syncStatus: "syncing", syncError: null, pendingDeletions: [] });
}

function finishStoreSyncOutcome(
  outcome: SyncOutcome,
  pendingDeletions: SyncDeletionReviewItem[] | undefined,
  set: SyncStoreSetter
): void {
  pendingSyncCount = Math.max(0, pendingSyncCount - 1);
  set({ pendingDeletions: pendingDeletions ?? [] });
  if (pendingSyncCount > 0) {
    // More store-requested work is still running: record this operation's
    // data truthfully but stay "syncing" until the last one settles.
    if (outcome === "cancelled") {
      set({ syncStatus: "syncing", syncError: null });
    } else {
      set({
        syncStatus: "syncing",
        syncError: null,
        lastSyncedAt: Math.floor(Date.now() / 1000),
      });
    }
    return;
  }
  applySyncOutcome(outcome, set);
}

function finishStoreSyncError(set: SyncStoreSetter, message: string): void {
  pendingSyncCount = Math.max(0, pendingSyncCount - 1);
  if (pendingSyncCount > 0) {
    set({ syncStatus: "syncing", syncError: message });
    return;
  }
  set({ syncStatus: "error", syncError: message });
}

interface SyncStore {
  authStatus: AuthStatus;
  userEmail: string | null;
  authToken: string | null;
  syncStatus: SyncStatus;
  lastSyncedAt: number | null;
  syncError: string | null;
  apiUrl: string;
  bookSyncMeta: Record<string, SyncItemMeta>;
  syncLog: SyncLogEntry[];
  pendingDeletions: SyncDeletionReviewItem[];
  authVerified: boolean;
  /** Epoch ms of the last successful login or token refresh this launch. Not persisted. */
  authRefreshedAt: number | null;
  passphrase: string | null;

  setApiUrl: (url: string) => void;
  setPassphrase: (passphrase: string | null) => void;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  loginWithOAuth: (provider: string) => Promise<void>;
  logout: () => void;
  verifyAuth: () => Promise<void>;
  /**
   * Renew the auth token now. A 401 means the session is gone (logs out with
   * sync.sessionExpired); offline or network failures keep the current state.
   */
  refreshSession: () => Promise<SessionRefreshResult>;
  /** Renew the token only when the refresh policy says it is due. */
  keepSessionAlive: () => Promise<SessionRefreshResult>;
  syncAll: (
    passphrase: string,
    onConflict: ConflictResolver,
    options?: Partial<SyncOptions>
  ) => Promise<void>;
  syncSingleBook: (
    bookId: string,
    passphrase: string,
    onConflict: ConflictResolver,
    options?: Partial<SyncOptions>
  ) => Promise<void>;
  syncSingleNote: (
    noteId: string,
    passphrase: string,
    onConflict: ConflictResolver,
    options?: Partial<SyncOptions>
  ) => Promise<void>;
  updateBookMeta: (bookId: string, meta: SyncItemMeta) => void;
  confirmPendingDeletions: (ids: string[]) => Promise<void>;
  clearSyncLog: () => void;
}

function applySyncOutcome(outcome: SyncOutcome, set: (partial: Partial<SyncStore>) => void): void {
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
      syncLog: [],
      pendingDeletions: [],
      authVerified: false,
      authRefreshedAt: null,
      passphrase: null,

      setApiUrl: (url) => {
        const apiUrl = normalizeServerUrl(url);
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
          authRefreshedAt: Date.now(),
        });
      },

      register: async (email, password) => {
        const result = await pbRegister(email, password);
        set({
          authStatus: "logged-in",
          userEmail: result.email,
          authToken: result.token,
          authVerified: true,
          authRefreshedAt: Date.now(),
        });
      },

      loginWithOAuth: async (provider) => {
        const result = await pbLoginWithOAuth(provider);
        set({
          authStatus: "logged-in",
          userEmail: result.email,
          authToken: result.token,
          authVerified: true,
          authRefreshedAt: Date.now(),
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
          authRefreshedAt: null,
          passphrase: null,
          syncStatus: "idle",
          syncError: null,
          bookSyncMeta: {},
          syncLog: [],
          pendingDeletions: [],
        });
      },

      verifyAuth: async (): Promise<void> => {
        const result = await useSyncStore.getState().refreshSession();
        if (result !== "refreshed") return;

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
      },

      refreshSession: async (): Promise<SessionRefreshResult> => {
        const { authToken, apiUrl } = useSyncStore.getState();
        if (!authToken || !apiUrl) return "skipped";
        if (!navigator.onLine) return "offline";

        // The session can change while the request is in flight (logout, a new
        // login, or a concurrent refresh that already stored the renewed token).
        const sessionChanged = (renewedToken?: string) => {
          const current = useSyncStore.getState().authToken;
          return current !== authToken && current !== renewedToken;
        };

        try {
          const result = await pbRefreshAuth();
          if (sessionChanged(result.token)) return "skipped";
          set({
            authStatus: "logged-in",
            userEmail: result.email,
            authToken: result.token,
            authVerified: true,
            authRefreshedAt: Date.now(),
          });
          return "refreshed";
        } catch (error: unknown) {
          if (sessionChanged()) return "skipped";
          const status = (error as { status?: number }).status;
          if (status === 401) {
            set({
              authStatus: "logged-out",
              userEmail: null,
              authToken: null,
              authVerified: false,
              authRefreshedAt: null,
              syncError: "sync.sessionExpired",
            });
            return "expired";
          }
          // Network errors: keep optimistic state, authVerified stays false
          return "failed";
        }
      },

      keepSessionAlive: async (): Promise<SessionRefreshResult> => {
        const { authStatus, authToken, authVerified, authRefreshedAt } = useSyncStore.getState();
        if (authStatus !== "logged-in") return "skipped";
        const due = shouldRefreshAuth({
          token: authToken,
          authVerified,
          refreshedAt: authRefreshedAt,
          now: Date.now(),
        });
        if (!due) return "skipped";
        return useSyncStore.getState().refreshSession();
      },

      syncAll: async (passphrase, onConflict, options) => {
        beginStoreSync(set);
        try {
          const result = await syncAllBooks(passphrase, onConflict, {
            scope: "all",
            direction: "bidirectional",
            ...options,
            onLog: (entry) => {
              set((state) => ({
                syncLog: [entry, ...state.syncLog].slice(0, MAX_SYNC_LOG_ENTRIES),
              }));
              options?.onLog?.(entry);
            },
          });
          finishStoreSyncOutcome(result.outcome, result.pendingDeletions, set);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Sync failed";
          finishStoreSyncError(set, message);
          throw error;
        }
      },

      syncSingleBook: async (bookId, passphrase, onConflict, options) => {
        beginStoreSync(set);
        try {
          const result = await syncBook(bookId, passphrase, onConflict, {
            scope: "books",
            direction: "bidirectional",
            ...options,
            onLog: (entry) => {
              set((state) => ({
                syncLog: [entry, ...state.syncLog].slice(0, MAX_SYNC_LOG_ENTRIES),
              }));
              options?.onLog?.(entry);
            },
          });
          finishStoreSyncOutcome(result.outcome, result.pendingDeletions, set);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Sync failed";
          finishStoreSyncError(set, message);
          throw error;
        }
      },

      syncSingleNote: async (noteId, passphrase, onConflict, options) => {
        beginStoreSync(set);
        try {
          const result = await engineSyncSingleNote(noteId, passphrase, onConflict, {
            scope: "notes",
            direction: "bidirectional",
            ...options,
            onLog: (entry) => {
              set((state) => ({
                syncLog: [entry, ...state.syncLog].slice(0, MAX_SYNC_LOG_ENTRIES),
              }));
              options?.onLog?.(entry);
            },
          });
          finishStoreSyncOutcome(result.outcome, result.pendingDeletions, set);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Sync failed";
          finishStoreSyncError(set, message);
          throw error;
        }
      },

      updateBookMeta: (bookId, meta) => {
        set((state) => ({
          bookSyncMeta: { ...state.bookSyncMeta, [bookId]: meta },
        }));
      },

      confirmPendingDeletions: async (ids) => {
        await confirmTombstones(ids);
        set((state) => ({
          pendingDeletions: state.pendingDeletions.filter((item) => !ids.includes(item.id)),
        }));
      },

      clearSyncLog: () => {
        set({ syncLog: [] });
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
    }
  )
);
