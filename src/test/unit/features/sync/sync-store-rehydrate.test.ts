import { afterEach, describe, it, expect, vi } from "vitest";

// A launch with a saved Sync Account: the store is first imported with its
// session already in localStorage, so persist rehydrates while `create` is
// still building the store.
const { mockInitClient, mockRestoreAuth, mockRefreshAuth } = vi.hoisted(() => ({
  mockInitClient: vi.fn(),
  mockRestoreAuth: vi.fn(),
  mockRefreshAuth: vi.fn(),
}));

vi.mock("../../../../features/sync/client", () => ({
  initClient: mockInitClient,
  normalizeServerUrl: (url: string) => url,
  restoreAuth: mockRestoreAuth,
  refreshAuth: mockRefreshAuth,
  login: vi.fn(),
  register: vi.fn(),
  loginWithOAuth: vi.fn(),
  logout: vi.fn(),
}));

vi.mock("../../../../features/sync/crypto", () => ({
  setPassphrase: vi.fn(),
  clearPassphrase: vi.fn(),
}));

describe("useSyncStore launch rehydration", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("verifies a saved session with the server when the store loads", async () => {
    mockRefreshAuth.mockResolvedValue({ token: "renewed", email: "author@example.com" });
    localStorage.setItem(
      "maibuk-sync",
      JSON.stringify({
        state: {
          authStatus: "logged-in",
          userEmail: "author@example.com",
          authToken: "saved",
          apiUrl: "http://127.0.0.1:8090",
          passphrase: "test passphrase",
          lastSyncedAt: null,
          bookSyncMeta: {},
        },
        version: 0,
      })
    );

    const { useSyncStore } = await import("@/features/sync/store");

    await vi.waitFor(() => expect(useSyncStore.getState().authVerified).toBe(true));
    expect(mockRestoreAuth).toHaveBeenCalledWith("saved");
    expect(mockRefreshAuth).toHaveBeenCalledTimes(1);
  });
});
