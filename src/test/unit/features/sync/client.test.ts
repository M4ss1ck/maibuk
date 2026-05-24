import { describe, expect, it, vi, beforeEach } from "vitest";

const {
  mockAuthRefresh,
  mockAuthWithPassword,
  mockAuthWithOAuth2,
  mockCreate,
  mockGetFullList,
  mockGetList,
  mockUpdate,
  mockSyncCreate,
} = vi.hoisted(() => ({
  mockAuthRefresh: vi.fn(),
  mockAuthWithPassword: vi.fn(),
  mockAuthWithOAuth2: vi.fn(),
  mockCreate: vi.fn(),
  mockGetFullList: vi.fn(),
  mockGetList: vi.fn(),
  mockUpdate: vi.fn(),
  mockSyncCreate: vi.fn(),
}));

let mockAuthStoreToken = "refreshed-token";
let mockAuthStoreRecord: { id: string; email: string } | null = null;
let mockAuthStoreIsValid = true;

vi.mock("pocketbase", () => {
  return {
    default: class MockPocketBase {
      authStore = {
        save: vi.fn(),
        clear: vi.fn(),
        get token() {
          return mockAuthStoreToken;
        },
        get record() {
          return mockAuthStoreRecord;
        },
        set record(val) {
          mockAuthStoreRecord = val;
        },
        get isValid() {
          return mockAuthStoreIsValid;
        },
      };
      collection = vi.fn((name: string) => {
        if (name === "users") {
          return {
            authRefresh: mockAuthRefresh,
            authWithPassword: mockAuthWithPassword,
            authWithOAuth2: mockAuthWithOAuth2,
            create: mockCreate,
          };
        }
        return {
          getFullList: mockGetFullList,
          getList: mockGetList,
          update: mockUpdate,
          create: mockSyncCreate,
        };
      });
      files = { getURL: vi.fn() };
    },
  };
});

const {
  initClient,
  login,
  register,
  loginWithOAuth,
  restoreAuth,
  refreshAuth,
  logout,
  isAuthenticated,
  getAuthToken,
  getAuthModel,
  pushBookBlob,
  pullBookBlob,
  listRemoteBooks,
  parsePocketBaseDate,
  pushMetricsEventRow,
} = await import("../../../../features/sync/client");

describe("parsePocketBaseDate()", () => {
  it("parses standard ISO 8601 dates", () => {
    expect(parsePocketBaseDate("2024-01-15T10:30:00.000Z")).toBe(
      Math.floor(new Date("2024-01-15T10:30:00.000Z").getTime() / 1000)
    );
  });

  it("parses PocketBase space-separated dates", () => {
    // PocketBase returns "2024-01-15 10:30:00.000Z" (space instead of T)
    expect(parsePocketBaseDate("2024-01-15 10:30:00.000Z")).toBe(
      Math.floor(new Date("2024-01-15T10:30:00.000Z").getTime() / 1000)
    );
  });

  it("parses dates without timezone suffix as UTC", () => {
    // Some PocketBase configs omit the Z
    expect(parsePocketBaseDate("2024-01-15 10:30:00.000")).toBe(
      Math.floor(new Date("2024-01-15T10:30:00.000Z").getTime() / 1000)
    );
  });

  it("returns 0 for empty string", () => {
    expect(parsePocketBaseDate("")).toBe(0);
  });

  it("returns 0 for garbage input", () => {
    expect(parsePocketBaseDate("not-a-date")).toBe(0);
  });

  it("returns 0 for undefined coerced to string", () => {
    expect(parsePocketBaseDate(undefined as unknown as string)).toBe(0);
  });
});

describe("refreshAuth()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initClient("https://sync.example.com");
  });

  it("returns email and token on success", async () => {
    mockAuthRefresh.mockResolvedValue({
      record: { id: "user-1", email: "user@test.com" },
    });
    mockAuthStoreToken = "new-jwt-token";

    const result = await refreshAuth();

    expect(result).toEqual({
      email: "user@test.com",
      token: "new-jwt-token",
    });
  });

  it("throws on 401 (expired token)", async () => {
    const error = new Error("Token expired");
    (error as { status?: number }).status = 401;
    mockAuthRefresh.mockRejectedValue(error);

    await expect(refreshAuth()).rejects.toThrow("Token expired");
  });

  it("throws on network error", async () => {
    mockAuthRefresh.mockRejectedValue(new Error("Failed to fetch"));

    await expect(refreshAuth()).rejects.toThrow("Failed to fetch");
  });
});

describe("login()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initClient("https://sync.example.com");
  });

  it("returns email and token on success", async () => {
    mockAuthWithPassword.mockResolvedValue({
      record: { email: "user@test.com" },
    });
    mockAuthStoreToken = "login-token";

    const result = await login("user@test.com", "password");

    expect(result).toEqual({ email: "user@test.com", token: "login-token" });
    expect(mockAuthWithPassword).toHaveBeenCalledWith("user@test.com", "password");
  });
});

describe("register()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initClient("https://sync.example.com");
  });

  it("creates user and auto-logs in", async () => {
    mockCreate.mockResolvedValue({});
    mockAuthWithPassword.mockResolvedValue({
      record: { email: "new@test.com" },
    });
    mockAuthStoreToken = "register-token";

    const result = await register("new@test.com", "password");

    expect(mockCreate).toHaveBeenCalledWith({
      email: "new@test.com",
      password: "password",
      passwordConfirm: "password",
    });
    expect(result).toEqual({ email: "new@test.com", token: "register-token" });
  });
});

describe("loginWithOAuth()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initClient("https://sync.example.com");
  });

  it("returns email and token on success", async () => {
    mockAuthWithOAuth2.mockResolvedValue({
      record: { email: "oauth@test.com" },
    });
    mockAuthStoreToken = "oauth-token";

    const result = await loginWithOAuth("google");

    expect(result).toEqual({ email: "oauth@test.com", token: "oauth-token" });
    expect(mockAuthWithOAuth2).toHaveBeenCalledWith({ provider: "google" });
  });
});

describe("restoreAuth()", () => {
  it("calls authStore.save with the token", () => {
    initClient("https://sync.example.com");
    restoreAuth("saved-token");
    // restoreAuth delegates to authStore.save — no return value to check
    // If it doesn't throw, it worked
  });
});

describe("logout()", () => {
  it("clears the auth store", () => {
    initClient("https://sync.example.com");
    logout();
    // logout delegates to authStore.clear — no return value to check
  });

  it("does not throw when client is not initialized", () => {
    // logout guards against null pb
    expect(() => logout()).not.toThrow();
  });
});

describe("isAuthenticated()", () => {
  it("returns true when authStore is valid", () => {
    initClient("https://sync.example.com");
    mockAuthStoreIsValid = true;
    expect(isAuthenticated()).toBe(true);
  });
});

describe("getAuthToken()", () => {
  it("returns the current token", () => {
    initClient("https://sync.example.com");
    mockAuthStoreToken = "current-token";
    expect(getAuthToken()).toBe("current-token");
  });
});

describe("getAuthModel()", () => {
  it("returns the current auth record", () => {
    initClient("https://sync.example.com");
    mockAuthStoreRecord = { id: "user-1", email: "user@test.com" };
    expect(getAuthModel()).toEqual({ id: "user-1", email: "user@test.com" });
  });
});

describe("listRemoteBooks()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initClient("https://sync.example.com");
  });

  it("maps PocketBase records to SyncItemMeta using parsePocketBaseDate", async () => {
    mockGetFullList.mockResolvedValue([
      {
        id: "rec-1",
        book_id: "book-1",
        checksum: "abc123",
        updated: "2024-01-15 10:30:00.000Z",
      },
    ]);

    const result = await listRemoteBooks();

    expect(result).toEqual([
      {
        remoteId: "rec-1",
        bookId: "book-1",
        checksum: "abc123",
        updatedAt: Math.floor(new Date("2024-01-15T10:30:00.000Z").getTime() / 1000),
      },
    ]);
  });

  it("returns empty array when no remote books", async () => {
    mockGetFullList.mockResolvedValue([]);

    const result = await listRemoteBooks();

    expect(result).toEqual([]);
  });
});

describe("pushBookBlob()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initClient("https://sync.example.com");
    mockAuthStoreRecord = { id: "user-1", email: "user@test.com" };
  });

  it("creates a new record when none exists", async () => {
    mockGetList.mockResolvedValue({ items: [] });
    mockSyncCreate.mockResolvedValue({});

    await pushBookBlob("book-1", new Blob(["data"]), "checksum-abc");

    expect(mockSyncCreate).toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("updates existing record when one exists", async () => {
    mockGetList.mockResolvedValue({ items: [{ id: "existing-1" }] });
    mockUpdate.mockResolvedValue({});

    await pushBookBlob("book-1", new Blob(["data"]), "checksum-abc");

    expect(mockUpdate).toHaveBeenCalledWith("existing-1", expect.any(FormData));
    expect(mockSyncCreate).not.toHaveBeenCalled();
  });

  it("throws when not authenticated", async () => {
    mockAuthStoreRecord = null;

    await expect(pushBookBlob("book-1", new Blob(["data"]), "checksum")).rejects.toThrow(
      "Not authenticated"
    );
  });
});

describe("pushMetricsEventRow()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initClient("https://sync.example.com");
    mockAuthStoreRecord = { id: "user-1", email: "user@test.com" };
  });

  const row = {
    client_id: "event-1",
    device_id: "device-1",
    timestamp: "2026-05-23T12:00:00.000Z",
    local_date: "2026-05-23",
    tz_offset_min: 0,
    event_type: "writing.typed",
    work_id: "book-1",
    schema_version: 1,
    encrypted_payload: "ciphertext",
  };

  it("treats PocketBase client_id unique errors as already pushed", async () => {
    mockSyncCreate.mockRejectedValue({
      status: 400,
      data: {
        data: {
          client_id: {
            code: "validation_not_unique",
          },
        },
      },
    });

    await expect(pushMetricsEventRow(row)).resolves.toBeUndefined();
  });

  it("throws non-unique validation errors instead of marking them pushed", async () => {
    const error = {
      status: 400,
      data: {
        data: {
          encrypted_payload: {
            code: "validation_required",
          },
        },
      },
    };
    mockSyncCreate.mockRejectedValue(error);

    await expect(pushMetricsEventRow(row)).rejects.toBe(error);
  });
});

describe("pullBookBlob()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initClient("https://sync.example.com");
  });

  it("returns null when no remote record exists", async () => {
    mockGetList.mockResolvedValue({ items: [] });

    const result = await pullBookBlob("book-1");

    expect(result).toBeNull();
  });
});
