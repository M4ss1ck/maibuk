import { describe, it, expect, beforeEach, vi } from "vitest";

// Covers the store half of sync concurrency: while more than one
// store-requested operation is pending, syncStatus stays "syncing" — an
// earlier completion or error must not falsely mark a still-running sync as
// done — and the final status reflects the last operation to settle.
const { mockSyncAllBooks } = vi.hoisted(() => ({
  mockSyncAllBooks: vi.fn(),
}));

vi.mock("@/features/sync/client", () => ({
  initClient: vi.fn(),
  normalizeServerUrl: (url: string) => url,
  restoreAuth: vi.fn(),
  refreshAuth: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
  loginWithOAuth: vi.fn(),
  logout: vi.fn(),
}));

vi.mock("@/features/sync/crypto", () => ({
  setPassphrase: vi.fn(),
  clearPassphrase: vi.fn(),
}));

vi.mock("@/features/sync/sync-engine", () => ({
  syncAllBooks: mockSyncAllBooks,
  syncBook: vi.fn(),
  syncSingleNote: vi.fn(),
}));

vi.mock("@/features/sync/tombstones", () => ({
  confirmTombstones: vi.fn(),
}));

const { useSyncStore, resetSyncStoreConcurrencyForTests } = await import(
  "@/features/sync/store"
);

function resetSyncStore() {
  resetSyncStoreConcurrencyForTests();
  useSyncStore.setState({
    authStatus: "logged-out",
    userEmail: null,
    authToken: null,
    authVerified: false,
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

function tick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 10));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useSyncStore — concurrent sync status", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    resetSyncStore();
  });

  it("stays syncing until the last of two overlapping syncs settles", async () => {
    const firstGate = deferred<{ outcome: string; actions: string[] }>();
    const secondGate = deferred<void>();
    mockSyncAllBooks.mockImplementationOnce(() => firstGate.promise);
    mockSyncAllBooks.mockImplementationOnce(async () => {
      await secondGate.promise;
      return { outcome: "success", actions: ["skipped"] };
    });

    const first = useSyncStore.getState().syncAll("pass", vi.fn());
    const second = useSyncStore.getState().syncAll("pass", vi.fn());
    await tick();
    expect(useSyncStore.getState().syncStatus).toBe("syncing");

    firstGate.resolve({ outcome: "success", actions: ["pushed"] });
    await first;
    // The second sync is still running: not falsely marked done.
    expect(useSyncStore.getState().syncStatus).toBe("syncing");

    secondGate.resolve();
    await second;
    expect(useSyncStore.getState().syncStatus).toBe("success");
    expect(useSyncStore.getState().lastSyncedAt).toBeGreaterThan(0);
    expect(useSyncStore.getState().syncError).toBeNull();
  });

  it("keeps syncing when the first of two syncs fails, then reports the last outcome", async () => {
    const firstGate = deferred<never>();
    const secondGate = deferred<void>();
    mockSyncAllBooks.mockImplementationOnce(() => firstGate.promise);
    mockSyncAllBooks.mockImplementationOnce(async () => {
      await secondGate.promise;
      return { outcome: "success", actions: ["skipped"] };
    });

    const first = useSyncStore.getState().syncAll("pass", vi.fn());
    // Attach a handler now so the rejection is never unhandled.
    const firstSettled = first.then(
      () => "resolved",
      (error: Error) => error.message
    );
    const second = useSyncStore.getState().syncAll("pass", vi.fn());
    await tick();

    firstGate.reject(new Error("boom"));
    await expect(firstSettled).resolves.toBe("boom");
    // The second sync is still running: status stays syncing, and the
    // first caller's rejection still propagated to its own caller.
    await expect(first).rejects.toThrow("boom");
    expect(useSyncStore.getState().syncStatus).toBe("syncing");

    secondGate.resolve();
    await second;
    expect(useSyncStore.getState().syncStatus).toBe("success");
    expect(useSyncStore.getState().syncError).toBeNull();
  });

  it("applies each caller's pending deletions without ending the pending sync early", async () => {
    const firstGate = deferred<{
      outcome: string;
      actions: string[];
      pendingDeletions: { id: string }[];
    }>();
    const secondGate = deferred<void>();
    mockSyncAllBooks.mockImplementationOnce(() => firstGate.promise);
    mockSyncAllBooks.mockImplementationOnce(async () => {
      await secondGate.promise;
      return { outcome: "success", actions: ["skipped"] };
    });

    const first = useSyncStore.getState().syncAll("pass", vi.fn());
    const second = useSyncStore.getState().syncAll("pass", vi.fn());
    await tick();

    firstGate.resolve({
      outcome: "partial",
      actions: [],
      pendingDeletions: [{ id: "book:book-1" }],
    });
    await first;
    expect(useSyncStore.getState().syncStatus).toBe("syncing");
    expect(useSyncStore.getState().pendingDeletions).toEqual([{ id: "book:book-1" }]);

    secondGate.resolve();
    await second;
    expect(useSyncStore.getState().syncStatus).toBe("success");
    expect(useSyncStore.getState().pendingDeletions).toEqual([]);
  });
});
