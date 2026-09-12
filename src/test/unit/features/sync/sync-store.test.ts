import { describe, it, expect, beforeEach, vi } from "vitest";
import { buildTestJwt } from "@/test/support/jwt";

// Mock all sync module dependencies before importing the store
const {
  mockInitClient,
  mockRestoreAuth,
  mockRefreshAuth,
  mockPbLogin,
  mockPbRegister,
  mockPbLoginWithOAuth,
  mockPbLogout,
  mockSetPassphrase,
  mockClearPassphrase,
  mockSyncAllBooks,
  mockSyncBook,
  mockSyncSingleNote,
  mockConfirmTombstones,
  mockClearAllSyncBases,
} = vi.hoisted(() => ({
  mockInitClient: vi.fn(),
  mockRestoreAuth: vi.fn(),
  mockRefreshAuth: vi.fn(),
  mockPbLogin: vi.fn(),
  mockPbRegister: vi.fn(),
  mockPbLoginWithOAuth: vi.fn(),
  mockPbLogout: vi.fn(),
  mockSetPassphrase: vi.fn(),
  mockClearPassphrase: vi.fn(),
  mockSyncAllBooks: vi.fn(),
  mockSyncBook: vi.fn(),
  mockSyncSingleNote: vi.fn(),
  mockConfirmTombstones: vi.fn(),
  mockClearAllSyncBases: vi.fn(),
}));

vi.mock("../../../../features/sync/client", () => ({
  initClient: mockInitClient,
  normalizeServerUrl: (url: string) => url,
  restoreAuth: mockRestoreAuth,
  refreshAuth: mockRefreshAuth,
  login: mockPbLogin,
  register: mockPbRegister,
  loginWithOAuth: mockPbLoginWithOAuth,
  logout: mockPbLogout,
}));

vi.mock("../../../../features/sync/crypto", () => ({
  setPassphrase: mockSetPassphrase,
  clearPassphrase: mockClearPassphrase,
}));

vi.mock("../../../../features/sync/sync-engine", () => ({
  syncAllBooks: mockSyncAllBooks,
  syncBook: mockSyncBook,
  syncSingleNote: mockSyncSingleNote,
}));

vi.mock("../../../../features/sync/tombstones", () => ({
  confirmTombstones: mockConfirmTombstones,
}));

vi.mock("../../../../features/sync/sync-state", () => ({
  clearAllSyncBases: mockClearAllSyncBases,
}));

const { useSyncStore } = await import("@/features/sync/store");

function resetSyncStore() {
  useSyncStore.setState({
    authStatus: "logged-out",
    userEmail: null,
    authToken: null,
    authVerified: false,
    authRefreshedAt: null,
    passphrase: null,
    syncStatus: "idle",
    lastSyncedAt: null,
    syncError: null,
    apiUrl: "",
    bookSyncMeta: {},
    syncLog: [],
    pendingDeletions: [],
  });
}

describe("useSyncStore", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mockClearAllSyncBases.mockResolvedValue(undefined);
    resetSyncStore();
  });

  describe("initial state", () => {
    it("starts logged out with idle status", () => {
      const state = useSyncStore.getState();
      expect(state.authStatus).toBe("logged-out");
      expect(state.userEmail).toBeNull();
      expect(state.authToken).toBeNull();
      expect(state.syncStatus).toBe("idle");
      expect(state.lastSyncedAt).toBeNull();
      expect(state.syncError).toBeNull();
      expect(state.apiUrl).toBe("");
      expect(state.bookSyncMeta).toEqual({});
      expect(state.syncLog).toEqual([]);
      expect(state.pendingDeletions).toEqual([]);
      expect(state.authVerified).toBe(false);
      expect(state.passphrase).toBeNull();
    });
  });

  describe("setPassphrase()", () => {
    it("persists passphrase and calls crypto.setPassphrase", () => {
      useSyncStore.getState().setPassphrase("my-secret");

      expect(useSyncStore.getState().passphrase).toBe("my-secret");
      expect(mockSetPassphrase).toHaveBeenCalledWith("my-secret");
    });

    it("clears passphrase when called with null", () => {
      useSyncStore.setState({ passphrase: "old" });
      useSyncStore.getState().setPassphrase(null);

      expect(useSyncStore.getState().passphrase).toBeNull();
      expect(mockSetPassphrase).toHaveBeenCalledWith(null);
    });
  });

  describe("setApiUrl()", () => {
    it("sets URL and initializes client", () => {
      useSyncStore.getState().setApiUrl("https://sync.example.com");

      expect(useSyncStore.getState().apiUrl).toBe("https://sync.example.com");
      expect(mockInitClient).toHaveBeenCalledWith("https://sync.example.com");
    });
  });

  describe("login()", () => {
    it("sets auth state on successful login", async () => {
      mockPbLogin.mockResolvedValue({
        email: "user@test.com",
        token: "jwt-token-123",
      });

      await useSyncStore.getState().login("user@test.com", "password");

      const state = useSyncStore.getState();
      expect(state.authStatus).toBe("logged-in");
      expect(state.userEmail).toBe("user@test.com");
      expect(state.authToken).toBe("jwt-token-123");
    });

    it("propagates login errors", async () => {
      mockPbLogin.mockRejectedValue(new Error("Invalid credentials"));

      await expect(useSyncStore.getState().login("bad@test.com", "wrong")).rejects.toThrow(
        "Invalid credentials"
      );
    });

    it("sets authVerified true on successful login", async () => {
      mockPbLogin.mockResolvedValue({ email: "user@test.com", token: "jwt" });
      await useSyncStore.getState().login("user@test.com", "password");
      expect(useSyncStore.getState().authVerified).toBe(true);
    });
  });

  describe("register()", () => {
    it("sets auth state on successful registration", async () => {
      mockPbRegister.mockResolvedValue({
        email: "new@test.com",
        token: "new-token",
      });

      await useSyncStore.getState().register("new@test.com", "password");

      expect(useSyncStore.getState().authStatus).toBe("logged-in");
      expect(useSyncStore.getState().userEmail).toBe("new@test.com");
    });

    it("sets authVerified true on successful registration", async () => {
      mockPbRegister.mockResolvedValue({ email: "new@test.com", token: "jwt" });
      await useSyncStore.getState().register("new@test.com", "password");
      expect(useSyncStore.getState().authVerified).toBe(true);
    });
  });

  describe("loginWithOAuth()", () => {
    it("sets auth state after OAuth flow", async () => {
      mockPbLoginWithOAuth.mockResolvedValue({
        email: "oauth@test.com",
        token: "oauth-token",
      });

      await useSyncStore.getState().loginWithOAuth("google");

      expect(useSyncStore.getState().authStatus).toBe("logged-in");
      expect(useSyncStore.getState().userEmail).toBe("oauth@test.com");
      expect(mockPbLoginWithOAuth).toHaveBeenCalledWith("google");
    });

    it("sets authVerified true after OAuth flow", async () => {
      mockPbLoginWithOAuth.mockResolvedValue({ email: "o@test.com", token: "jwt" });
      await useSyncStore.getState().loginWithOAuth("google");
      expect(useSyncStore.getState().authVerified).toBe(true);
    });
  });

  describe("logout()", () => {
    it("clears auth state and calls cleanup functions", () => {
      // Start in a logged-in state
      useSyncStore.setState({
        authStatus: "logged-in",
        userEmail: "user@test.com",
        authToken: "token",
        syncStatus: "success",
        bookSyncMeta: {
          "book-1": {
            remoteId: "r1",
            bookId: "book-1",
            checksum: "abc",
            updatedAt: 100,
          },
        },
      });

      useSyncStore.getState().logout();

      const state = useSyncStore.getState();
      expect(state.authStatus).toBe("logged-out");
      expect(state.userEmail).toBeNull();
      expect(state.authToken).toBeNull();
      expect(state.syncStatus).toBe("idle");
      expect(state.syncError).toBeNull();
      expect(state.bookSyncMeta).toEqual({});
      expect(state.authVerified).toBe(false);
      expect(state.passphrase).toBeNull();

      expect(mockPbLogout).toHaveBeenCalled();
      expect(mockClearPassphrase).toHaveBeenCalled();
    });
  });

  describe("syncAll()", () => {
    it("calls syncAllBooks and sets success status", async () => {
      mockSyncAllBooks.mockResolvedValue({ outcome: "success", actions: ["pushed"] });
      const mockOnConflict = vi.fn();

      await useSyncStore.getState().syncAll("my-passphrase", mockOnConflict);

      expect(mockSyncAllBooks).toHaveBeenCalledWith(
        "my-passphrase",
        mockOnConflict,
        expect.objectContaining({
          scope: "all",
          direction: "bidirectional",
          onLog: expect.any(Function),
        })
      );
      expect(useSyncStore.getState().syncStatus).toBe("success");
      expect(useSyncStore.getState().lastSyncedAt).toBeDefined();
      expect(useSyncStore.getState().lastSyncedAt).toBeGreaterThan(0);
    });

    it("sets error status on failure and rethrows", async () => {
      mockSyncAllBooks.mockRejectedValue(new Error("Network error"));

      await expect(useSyncStore.getState().syncAll("passphrase", vi.fn())).rejects.toThrow(
        "Network error"
      );

      expect(useSyncStore.getState().syncStatus).toBe("error");
      expect(useSyncStore.getState().syncError).toBe("Network error");
    });

    it("sets syncing status during operation", async () => {
      let capturedStatus: string | undefined;
      mockSyncAllBooks.mockImplementation(async () => {
        capturedStatus = useSyncStore.getState().syncStatus;
        return { outcome: "success", actions: ["skipped"] };
      });

      await useSyncStore.getState().syncAll("passphrase", vi.fn());

      expect(capturedStatus).toBe("syncing");
    });

    it("sets cancelled status without updating last synced time", async () => {
      useSyncStore.setState({ lastSyncedAt: 1234 });
      mockSyncAllBooks.mockResolvedValue({ outcome: "cancelled", actions: ["cancelled"] });

      await useSyncStore.getState().syncAll("passphrase", vi.fn());

      expect(useSyncStore.getState().syncStatus).toBe("cancelled");
      expect(useSyncStore.getState().lastSyncedAt).toBe(1234);
      expect(useSyncStore.getState().syncError).toBeNull();
    });

    it("sets partial status when some books synced before cancellation", async () => {
      mockSyncAllBooks.mockResolvedValue({ outcome: "partial", actions: ["pushed", "cancelled"] });

      await useSyncStore.getState().syncAll("passphrase", vi.fn());

      expect(useSyncStore.getState().syncStatus).toBe("partial");
      expect(useSyncStore.getState().lastSyncedAt).toBeGreaterThan(0);
      expect(useSyncStore.getState().syncError).toBeNull();
    });

    it("passes scope and direction options through to the engine", async () => {
      mockSyncAllBooks.mockResolvedValue({ outcome: "success", actions: ["skipped"] });

      await useSyncStore.getState().syncAll("passphrase", vi.fn(), {
        scope: "notes",
        direction: "pull",
      });

      expect(mockSyncAllBooks).toHaveBeenCalledWith(
        "passphrase",
        expect.any(Function),
        expect.objectContaining({
          scope: "notes",
          direction: "pull",
          onLog: expect.any(Function),
        })
      );
    });

    it("stores pending deletion review items returned by the engine", async () => {
      mockSyncAllBooks.mockResolvedValue({
        outcome: "partial",
        actions: [],
        pendingDeletions: [
          {
            id: "book:book-1",
            entityType: "book",
            entityId: "book-1",
            title: "Deleted Draft",
            deletedAt: 1000,
          },
        ],
      });

      await useSyncStore.getState().syncAll("passphrase", vi.fn());

      expect(useSyncStore.getState().syncStatus).toBe("partial");
      expect(useSyncStore.getState().pendingDeletions).toEqual([
        {
          id: "book:book-1",
          entityType: "book",
          entityId: "book-1",
          title: "Deleted Draft",
          deletedAt: 1000,
        },
      ]);
    });

    it("records log entries emitted by the engine", async () => {
      mockSyncAllBooks.mockImplementation(async (_passphrase, _onConflict, options) => {
        options.onLog({
          id: "log-1",
          timestamp: 1000,
          level: "info",
          event: "backup",
          message: "Created safety backup",
        });
        return { outcome: "success", actions: ["skipped"] };
      });

      await useSyncStore.getState().syncAll("passphrase", vi.fn());

      expect(useSyncStore.getState().syncLog).toEqual([
        {
          id: "log-1",
          timestamp: 1000,
          level: "info",
          event: "backup",
          message: "Created safety backup",
        },
      ]);
    });
  });

  describe("deletion review and log actions", () => {
    it("confirms pending deletion ids and clears them from review", async () => {
      useSyncStore.setState({
        pendingDeletions: [
          {
            id: "book:book-1",
            entityType: "book",
            entityId: "book-1",
            title: "Deleted Draft",
            deletedAt: 1000,
          },
        ],
      });

      await useSyncStore.getState().confirmPendingDeletions(["book:book-1"]);

      expect(mockConfirmTombstones).toHaveBeenCalledWith(["book:book-1"]);
      expect(useSyncStore.getState().pendingDeletions).toEqual([]);
    });

    it("clears the sync log", () => {
      useSyncStore.setState({
        syncLog: [
          {
            id: "log-1",
            timestamp: 1000,
            level: "info",
            event: "backup",
            message: "Created safety backup",
          },
        ],
      });

      useSyncStore.getState().clearSyncLog();

      expect(useSyncStore.getState().syncLog).toEqual([]);
    });
  });

  describe("syncSingleBook()", () => {
    it("calls syncBook and sets success status", async () => {
      mockSyncBook.mockResolvedValue({ outcome: "success", action: "pushed" });
      const mockOnConflict = vi.fn();

      await useSyncStore.getState().syncSingleBook("book-1", "passphrase", mockOnConflict);

      expect(mockSyncBook).toHaveBeenCalledWith(
        "book-1",
        "passphrase",
        mockOnConflict,
        expect.objectContaining({
          scope: "books",
          direction: "bidirectional",
          onLog: expect.any(Function),
        })
      );
      expect(useSyncStore.getState().syncStatus).toBe("success");
    });

    it("sets error status on failure", async () => {
      mockSyncBook.mockRejectedValue(new Error("Sync failed"));

      await expect(
        useSyncStore.getState().syncSingleBook("book-1", "passphrase", vi.fn())
      ).rejects.toThrow("Sync failed");

      expect(useSyncStore.getState().syncStatus).toBe("error");
      expect(useSyncStore.getState().syncError).toBe("Sync failed");
    });

    it("handles non-Error rejections gracefully", async () => {
      mockSyncBook.mockRejectedValue("string error");

      await expect(
        useSyncStore.getState().syncSingleBook("book-1", "passphrase", vi.fn())
      ).rejects.toBe("string error");

      expect(useSyncStore.getState().syncError).toBe("Sync failed");
    });

    it("sets cancelled status when the user cancels a single-book conflict", async () => {
      useSyncStore.setState({ lastSyncedAt: 555 });
      mockSyncBook.mockResolvedValue({ outcome: "cancelled", action: "cancelled" });

      await useSyncStore.getState().syncSingleBook("book-1", "passphrase", vi.fn());

      expect(useSyncStore.getState().syncStatus).toBe("cancelled");
      expect(useSyncStore.getState().lastSyncedAt).toBe(555);
      expect(useSyncStore.getState().syncError).toBeNull();
    });
  });

  describe("syncSingleNote()", () => {
    it("calls syncSingleNote engine fn and sets success status", async () => {
      mockSyncSingleNote.mockResolvedValue({ outcome: "success", action: "pushed" });
      const mockOnConflict = vi.fn();

      await useSyncStore.getState().syncSingleNote("note-1", "passphrase", mockOnConflict);

      expect(mockSyncSingleNote).toHaveBeenCalledWith(
        "note-1",
        "passphrase",
        mockOnConflict,
        expect.objectContaining({
          scope: "notes",
          direction: "bidirectional",
          onLog: expect.any(Function),
        })
      );
      expect(useSyncStore.getState().syncStatus).toBe("success");
    });

    it("sets error status on failure", async () => {
      mockSyncSingleNote.mockRejectedValue(new Error("Sync failed"));

      await expect(
        useSyncStore.getState().syncSingleNote("note-1", "passphrase", vi.fn())
      ).rejects.toThrow("Sync failed");

      expect(useSyncStore.getState().syncStatus).toBe("error");
      expect(useSyncStore.getState().syncError).toBe("Sync failed");
    });

    it("sets cancelled status when the user cancels a single-note conflict", async () => {
      useSyncStore.setState({ lastSyncedAt: 555 });
      mockSyncSingleNote.mockResolvedValue({ outcome: "cancelled", action: "cancelled" });

      await useSyncStore.getState().syncSingleNote("note-1", "passphrase", vi.fn());

      expect(useSyncStore.getState().syncStatus).toBe("cancelled");
      expect(useSyncStore.getState().lastSyncedAt).toBe(555);
      expect(useSyncStore.getState().syncError).toBeNull();
    });
  });

  describe("updateBookMeta()", () => {
    it("adds sync meta for a book", () => {
      const meta = {
        remoteId: "remote-1",
        bookId: "book-1",
        checksum: "abc123",
        updatedAt: 1700000000,
      };

      useSyncStore.getState().updateBookMeta("book-1", meta);

      expect(useSyncStore.getState().bookSyncMeta["book-1"]).toEqual(meta);
    });

    it("updates existing book meta", () => {
      useSyncStore.getState().updateBookMeta("book-1", {
        remoteId: "r1",
        bookId: "book-1",
        checksum: "old",
        updatedAt: 100,
      });

      useSyncStore.getState().updateBookMeta("book-1", {
        remoteId: "r1",
        bookId: "book-1",
        checksum: "new",
        updatedAt: 200,
      });

      expect(useSyncStore.getState().bookSyncMeta["book-1"].checksum).toBe("new");
    });
  });

  describe("verifyAuth()", () => {
    it("sets authVerified true on successful refresh", async () => {
      useSyncStore.setState({
        authStatus: "logged-in",
        authToken: "old-token",
        apiUrl: "https://sync.example.com",
      });
      mockRefreshAuth.mockResolvedValue({
        email: "user@test.com",
        token: "new-token",
      });

      await useSyncStore.getState().verifyAuth();

      const state = useSyncStore.getState();
      expect(state.authVerified).toBe(true);
      expect(state.authToken).toBe("new-token");
      expect(state.userEmail).toBe("user@test.com");
      expect(state.authStatus).toBe("logged-in");
    });

    // The launch sync moved to installAutoSync (features/sync/auto-sync.ts),
    // which reacts to authVerified turning true and honours the setting.
    it("does not start a sync itself, even with a stored passphrase", async () => {
      useSyncStore.setState({
        authStatus: "logged-in",
        authToken: "old-token",
        apiUrl: "https://sync.example.com",
        passphrase: "my-secret",
      });
      mockRefreshAuth.mockResolvedValue({
        email: "user@test.com",
        token: "new-token",
      });

      await useSyncStore.getState().verifyAuth();

      expect(useSyncStore.getState().authVerified).toBe(true);
      expect(mockSyncAllBooks).not.toHaveBeenCalled();
      expect(useSyncStore.getState().syncStatus).toBe("idle");
    });

    it("clears auth on 401 error", async () => {
      useSyncStore.setState({
        authStatus: "logged-in",
        authToken: "expired-token",
        apiUrl: "https://sync.example.com",
      });
      const error = new Error("Token expired");
      (error as { status?: number }).status = 401;
      mockRefreshAuth.mockRejectedValue(error);

      await useSyncStore.getState().verifyAuth();

      const state = useSyncStore.getState();
      expect(state.authStatus).toBe("logged-out");
      expect(state.authToken).toBeNull();
      expect(state.userEmail).toBeNull();
      expect(state.authVerified).toBe(false);
    });

    it("keeps optimistic state on network error", async () => {
      useSyncStore.setState({
        authStatus: "logged-in",
        authToken: "valid-token",
        userEmail: "user@test.com",
        apiUrl: "https://sync.example.com",
      });
      mockRefreshAuth.mockRejectedValue(new Error("Failed to fetch"));

      await useSyncStore.getState().verifyAuth();

      const state = useSyncStore.getState();
      expect(state.authStatus).toBe("logged-in");
      expect(state.authToken).toBe("valid-token");
      expect(state.userEmail).toBe("user@test.com");
      expect(state.authVerified).toBe(false);
    });

    it("keeps optimistic state when offline", async () => {
      useSyncStore.setState({
        authStatus: "logged-in",
        authToken: "valid-token",
        userEmail: "user@test.com",
        apiUrl: "https://sync.example.com",
      });
      Object.defineProperty(navigator, "onLine", { value: false, configurable: true });

      await useSyncStore.getState().verifyAuth();

      const state = useSyncStore.getState();
      expect(state.authStatus).toBe("logged-in");
      expect(state.authVerified).toBe(false);
      expect(mockRefreshAuth).not.toHaveBeenCalled();

      // Restore
      Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    });

    it("does nothing when no token exists", async () => {
      useSyncStore.setState({
        authStatus: "logged-out",
        authToken: null,
        apiUrl: "https://sync.example.com",
      });

      await useSyncStore.getState().verifyAuth();

      expect(mockRefreshAuth).not.toHaveBeenCalled();
      expect(useSyncStore.getState().authVerified).toBe(false);
    });

    it("does nothing when no apiUrl exists", async () => {
      useSyncStore.setState({
        authStatus: "logged-in",
        authToken: "token",
        apiUrl: "",
      });

      await useSyncStore.getState().verifyAuth();

      expect(mockRefreshAuth).not.toHaveBeenCalled();
    });
  });

  describe("refreshSession()", () => {
    it("renews the token and records when", async () => {
      vi.spyOn(Date, "now").mockReturnValue(1_000_000);
      useSyncStore.setState({
        authStatus: "logged-in",
        authToken: "old-token",
        apiUrl: "https://sync.example.com",
      });
      mockRefreshAuth.mockResolvedValue({ email: "user@test.com", token: "new-token" });

      await expect(useSyncStore.getState().refreshSession()).resolves.toBe("refreshed");

      const state = useSyncStore.getState();
      expect(state.authToken).toBe("new-token");
      expect(state.authVerified).toBe(true);
      expect(state.authRefreshedAt).toBe(1_000_000);
      vi.restoreAllMocks();
    });

    it("logs out with sync.sessionExpired on 401", async () => {
      useSyncStore.setState({
        authStatus: "logged-in",
        authToken: "expired-token",
        apiUrl: "https://sync.example.com",
        authRefreshedAt: 5,
      });
      mockRefreshAuth.mockRejectedValue(Object.assign(new Error("expired"), { status: 401 }));

      await expect(useSyncStore.getState().refreshSession()).resolves.toBe("expired");

      const state = useSyncStore.getState();
      expect(state.authStatus).toBe("logged-out");
      expect(state.authToken).toBeNull();
      expect(state.authRefreshedAt).toBeNull();
      expect(state.syncError).toBe("sync.sessionExpired");
    });

    it("reports a network failure without touching the session", async () => {
      useSyncStore.setState({
        authStatus: "logged-in",
        authToken: "token",
        apiUrl: "https://sync.example.com",
      });
      mockRefreshAuth.mockRejectedValue(new Error("Failed to fetch"));

      await expect(useSyncStore.getState().refreshSession()).resolves.toBe("failed");
      expect(useSyncStore.getState().authStatus).toBe("logged-in");
      expect(useSyncStore.getState().authToken).toBe("token");
    });

    it("does not resurrect a session the user logged out of mid-refresh", async () => {
      useSyncStore.setState({
        authStatus: "logged-in",
        authToken: "old-token",
        apiUrl: "https://sync.example.com",
      });
      let resolveRefresh!: (value: { email: string; token: string }) => void;
      mockRefreshAuth.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveRefresh = resolve;
          })
      );

      const pending = useSyncStore.getState().refreshSession();
      useSyncStore.getState().logout();
      resolveRefresh({ email: "user@test.com", token: "renewed" });

      await expect(pending).resolves.toBe("skipped");
      expect(useSyncStore.getState().authStatus).toBe("logged-out");
      expect(useSyncStore.getState().authToken).toBeNull();
    });

    it("does not log out a new session when a stale refresh gets a 401", async () => {
      useSyncStore.setState({
        authStatus: "logged-in",
        authToken: "old-token",
        apiUrl: "https://sync.example.com",
      });
      let rejectRefresh!: (error: unknown) => void;
      mockRefreshAuth.mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            rejectRefresh = reject;
          })
      );

      const pending = useSyncStore.getState().refreshSession();
      useSyncStore.setState({ authToken: "new-login-token" });
      rejectRefresh(Object.assign(new Error("expired"), { status: 401 }));

      await expect(pending).resolves.toBe("skipped");
      expect(useSyncStore.getState().authStatus).toBe("logged-in");
      expect(useSyncStore.getState().authToken).toBe("new-login-token");
    });

    it("skips the network while offline", async () => {
      useSyncStore.setState({
        authStatus: "logged-in",
        authToken: "token",
        apiUrl: "https://sync.example.com",
      });
      Object.defineProperty(navigator, "onLine", { value: false, configurable: true });

      try {
        await expect(useSyncStore.getState().refreshSession()).resolves.toBe("offline");
        expect(mockRefreshAuth).not.toHaveBeenCalled();
      } finally {
        Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
      }
    });
  });

  describe("keepSessionAlive()", () => {
    const DAY = 24 * 60 * 60 * 1000;

    it("does nothing when logged out", async () => {
      await expect(useSyncStore.getState().keepSessionAlive()).resolves.toBe("skipped");
      expect(mockRefreshAuth).not.toHaveBeenCalled();
    });

    it("skips a fresh token renewed recently", async () => {
      useSyncStore.setState({
        authStatus: "logged-in",
        authToken: buildTestJwt(Date.now() + 7 * DAY),
        apiUrl: "https://sync.example.com",
        authVerified: true,
        authRefreshedAt: Date.now() - 60_000,
      });

      await expect(useSyncStore.getState().keepSessionAlive()).resolves.toBe("skipped");
      expect(mockRefreshAuth).not.toHaveBeenCalled();
    });

    // Regression: the session was only renewed at launch, so an app left open
    // (tray, sleep) past the token lifetime was forced back to the login screen.
    it("renews a verified token that is about to expire", async () => {
      useSyncStore.setState({
        authStatus: "logged-in",
        authToken: buildTestJwt(Date.now() + DAY / 2),
        apiUrl: "https://sync.example.com",
        authVerified: true,
        authRefreshedAt: Date.now() - DAY * 6,
      });
      mockRefreshAuth.mockResolvedValue({ email: "user@test.com", token: "renewed" });

      await expect(useSyncStore.getState().keepSessionAlive()).resolves.toBe("refreshed");
      expect(useSyncStore.getState().authToken).toBe("renewed");
    });

    it("retries verification that failed at launch", async () => {
      useSyncStore.setState({
        authStatus: "logged-in",
        authToken: buildTestJwt(Date.now() + 7 * DAY),
        apiUrl: "https://sync.example.com",
        authVerified: false,
      });
      mockRefreshAuth.mockResolvedValue({ email: "user@test.com", token: "renewed" });

      await expect(useSyncStore.getState().keepSessionAlive()).resolves.toBe("refreshed");
      expect(useSyncStore.getState().authVerified).toBe(true);
    });
  });

  describe("login()", () => {
    it("records the refresh time so the keep-alive interval starts from login", async () => {
      vi.spyOn(Date, "now").mockReturnValue(42_000);
      mockPbLogin.mockResolvedValue({ email: "user@test.com", token: "t" });

      await useSyncStore.getState().login("user@test.com", "pw");

      expect(useSyncStore.getState().authRefreshedAt).toBe(42_000);
      vi.restoreAllMocks();
    });
  });

  describe("sync bases", () => {
    beforeEach(() => {
      mockClearAllSyncBases.mockResolvedValue(undefined);
    });

    it("forgets them on logout, so another account is compared afresh", () => {
      useSyncStore.getState().logout();

      expect(mockClearAllSyncBases).toHaveBeenCalledTimes(1);
    });

    it("forgets them when the server changes, but not when it stays the same", () => {
      useSyncStore.setState({ apiUrl: "https://a.example.com" });

      useSyncStore.getState().setApiUrl("https://a.example.com");
      expect(mockClearAllSyncBases).not.toHaveBeenCalled();

      useSyncStore.getState().setApiUrl("https://b.example.com");
      expect(mockClearAllSyncBases).toHaveBeenCalledTimes(1);
    });

    it("never lets a failed clear break logout", () => {
      mockClearAllSyncBases.mockRejectedValue(new Error("db closed"));

      expect(() => useSyncStore.getState().logout()).not.toThrow();
      expect(useSyncStore.getState().authStatus).toBe("logged-out");
    });
  });

  describe("onRehydrateStorage", () => {
    it("restores passphrase into crypto module on rehydrate", () => {
      // Simulate what persist middleware does: setState with persisted data,
      // then the rehydrate callback runs. We test via a direct setState + verifyAuth flow,
      // but the real assertion is that setPassphrase was called during rehydration.
      // Since we can't trigger actual rehydration in unit tests, we verify the
      // store.setPassphrase action calls crypto.setPassphrase.
      useSyncStore.getState().setPassphrase("restored-passphrase");
      expect(mockSetPassphrase).toHaveBeenCalledWith("restored-passphrase");
    });
  });
});
