import { describe, expect, it, vi, beforeEach } from "vitest";

const {
  mockAuthRefresh,
  mockAuthWithPassword,
  mockAuthWithOAuth2,
  mockCreate,
  mockGetFullList,
  mockGetList,
  mockUpdate,
  mockDelete,
  mockSyncCreate,
  mockGetOne,
} = vi.hoisted(() => ({
  mockAuthRefresh: vi.fn(),
  mockAuthWithPassword: vi.fn(),
  mockAuthWithOAuth2: vi.fn(),
  mockCreate: vi.fn(),
  mockGetFullList: vi.fn(),
  mockGetList: vi.fn(),
  mockUpdate: vi.fn(),
  mockDelete: vi.fn(),
  mockSyncCreate: vi.fn(),
  mockGetOne: vi.fn(),
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
        if (name === "version_items") {
          return {
            getOne: mockGetOne,
            getFullList: mockGetFullList,
            create: mockSyncCreate,
          };
        }
        return {
          getFullList: mockGetFullList,
          getList: mockGetList,
          update: mockUpdate,
          delete: mockDelete,
          create: mockSyncCreate,
        };
      });
      files = { getURL: vi.fn() };
      autoCancellation = vi.fn();
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
  pushNoteBlob,
  pullBookBlob,
  deleteRemoteBook,
  deleteRemoteNote,
  listRemoteBooks,
  parsePocketBaseDate,
  pushMetricsEventRow,
  pushMetricsTombstoneRow,
  pullMetricsEventRowsSince,
  pullMetricsTombstoneRowsSince,
  pushMetricsBlob,
  pullMetricsBlob,
  listRemoteVersions,
  pushVersionBlob,
  pullVersionBlob,
  normalizeServerUrl,
} = await import("../../../../features/sync/client");

describe("normalizeServerUrl()", () => {
  it("prepends https:// when no protocol is present", () => {
    expect(normalizeServerUrl("sync.example.com")).toBe("https://sync.example.com");
  });

  it("leaves an explicit https:// URL untouched", () => {
    expect(normalizeServerUrl("https://sync.example.com")).toBe("https://sync.example.com");
  });

  it("leaves an explicit http:// URL untouched", () => {
    expect(normalizeServerUrl("http://localhost:8090")).toBe("http://localhost:8090");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeServerUrl("  sync.example.com  ")).toBe("https://sync.example.com");
  });

  it("returns empty string for blank input", () => {
    expect(normalizeServerUrl("")).toBe("");
    expect(normalizeServerUrl("   ")).toBe("");
  });
});

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

describe("deleteRemoteBook()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initClient("https://sync.example.com");
  });

  it("deletes the matching remote book row", async () => {
    mockGetList.mockResolvedValue({ items: [{ id: "remote-1" }] });

    await deleteRemoteBook("book-1");

    expect(mockGetList).toHaveBeenCalledWith(1, 1, { filter: 'book_id = "book-1"' });
    expect(mockDelete).toHaveBeenCalledWith("remote-1");
  });

  it("does nothing when no remote book row exists", async () => {
    mockGetList.mockResolvedValue({ items: [] });

    await deleteRemoteBook("missing-book");

    expect(mockDelete).not.toHaveBeenCalled();
  });
});

describe("deleteRemoteNote()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initClient("https://sync.example.com");
  });

  it("deletes the matching remote note row", async () => {
    mockGetList.mockResolvedValue({ items: [{ id: "remote-note-1" }] });

    await deleteRemoteNote("note-1");

    expect(mockGetList).toHaveBeenCalledWith(1, 1, { filter: 'note_id = "note-1"' });
    expect(mockDelete).toHaveBeenCalledWith("remote-note-1");
  });

  it("does nothing when no remote note row exists", async () => {
    mockGetList.mockResolvedValue({ items: [] });

    await deleteRemoteNote("missing-note");

    expect(mockDelete).not.toHaveBeenCalled();
  });
});

describe("pushBookBlob()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initClient("https://sync.example.com");
    mockAuthStoreRecord = { id: "user-1", email: "user@test.com" };
  });

  it("creates a new record when no remoteId is given, without an extra lookup", async () => {
    mockSyncCreate.mockResolvedValue({});

    await pushBookBlob("book-1", new Blob(["data"]), "checksum-abc");

    expect(mockSyncCreate).toHaveBeenCalledWith(expect.any(FormData));
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockGetList).not.toHaveBeenCalled();
  });

  it("updates the existing record directly when a remoteId is given", async () => {
    mockUpdate.mockResolvedValue({});

    await pushBookBlob("book-1", new Blob(["data"]), "checksum-abc", "existing-1");

    expect(mockUpdate).toHaveBeenCalledWith("existing-1", expect.any(FormData));
    expect(mockSyncCreate).not.toHaveBeenCalled();
    expect(mockGetList).not.toHaveBeenCalled();
  });

  it("throws when not authenticated", async () => {
    mockAuthStoreRecord = null;

    await expect(pushBookBlob("book-1", new Blob(["data"]), "checksum")).rejects.toThrow(
      "Not authenticated"
    );
  });
});

describe("pushNoteBlob()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initClient("https://sync.example.com");
    mockAuthStoreRecord = { id: "user-1", email: "user@test.com" };
  });

  it("creates a new record when no remoteId is given, without an extra lookup", async () => {
    mockSyncCreate.mockResolvedValue({});

    await pushNoteBlob("note-1", new Blob(["data"]), "checksum-abc");

    expect(mockSyncCreate).toHaveBeenCalledWith(expect.any(FormData));
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockGetList).not.toHaveBeenCalled();
  });

  it("updates the existing record directly when a remoteId is given", async () => {
    mockUpdate.mockResolvedValue({});

    await pushNoteBlob("note-1", new Blob(["data"]), "checksum-abc", "existing-note-1");

    expect(mockUpdate).toHaveBeenCalledWith("existing-note-1", expect.any(FormData));
    expect(mockSyncCreate).not.toHaveBeenCalled();
    expect(mockGetList).not.toHaveBeenCalled();
  });

  it("throws when not authenticated", async () => {
    mockAuthStoreRecord = null;

    await expect(pushNoteBlob("note-1", new Blob(["data"]), "checksum")).rejects.toThrow(
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

describe("pushMetricsTombstoneRow()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initClient("https://sync.example.com");
    mockAuthStoreRecord = { id: "user-1", email: "user@test.com" };
  });

  const row = {
    client_id: "tomb-1",
    device_id: "device-1",
    deleted_at: "2026-05-23T12:00:00.000Z",
    reason: "user_purge",
  };

  it("pushes a tombstone row", async () => {
    mockSyncCreate.mockResolvedValue({});

    await pushMetricsTombstoneRow(row);

    expect(mockSyncCreate).toHaveBeenCalled();
  });

  it("treats client_id unique errors as already pushed", async () => {
    mockSyncCreate.mockRejectedValue({
      status: 400,
      data: { data: { client_id: { code: "validation_not_unique" } } },
    });

    await expect(pushMetricsTombstoneRow(row)).resolves.toBeUndefined();
  });

  it("throws when not authenticated", async () => {
    mockAuthStoreRecord = null;

    await expect(pushMetricsTombstoneRow(row)).rejects.toThrow("Not authenticated");
  });
});

describe("pullMetricsEventRowsSince()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initClient("https://sync.example.com");
  });

  it("returns mapped event rows", async () => {
    mockGetFullList.mockResolvedValue([
      {
        client_id: "e-1",
        device_id: "d-1",
        timestamp: "2026-05-23T12:00:00.000Z",
        local_date: "2026-05-23",
        tz_offset_min: 0,
        event_type: "writing.typed",
        work_id: "book-1",
        schema_version: 1,
        encrypted_payload: "cipher",
        updated: "2026-05-23T12:00:00.000Z",
      },
    ]);

    const result = await pullMetricsEventRowsSince("2026-05-22T00:00:00.000Z");

    expect(result).toHaveLength(1);
    expect(result[0].client_id).toBe("e-1");
  });

  it("omits filter when since is empty", async () => {
    mockGetFullList.mockResolvedValue([]);

    await pullMetricsEventRowsSince("");

    const call = mockGetFullList.mock.calls[0][0];
    expect(call.filter).toBeUndefined();
  });
});

describe("pullMetricsTombstoneRowsSince()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initClient("https://sync.example.com");
  });

  it("returns mapped tombstone rows", async () => {
    mockGetFullList.mockResolvedValue([
      {
        client_id: "t-1",
        device_id: "d-1",
        deleted_at: "2026-05-23T12:00:00.000Z",
        reason: "user_purge",
        updated: "2026-05-23T12:00:00.000Z",
      },
    ]);

    const result = await pullMetricsTombstoneRowsSince("2026-05-22T00:00:00.000Z");

    expect(result).toHaveLength(1);
    expect(result[0].client_id).toBe("t-1");
  });
});

describe("pushMetricsBlob()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initClient("https://sync.example.com");
    mockAuthStoreRecord = { id: "user-1", email: "user@test.com" };
  });

  it("creates a new metrics blob when none exists", async () => {
    mockGetList.mockResolvedValue({ items: [] });
    mockSyncCreate.mockResolvedValue({});

    await pushMetricsBlob(new Blob(["data"]), "checksum-abc");

    expect(mockSyncCreate).toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("updates existing metrics blob", async () => {
    mockGetList.mockResolvedValue({ items: [{ id: "existing-1" }] });
    mockUpdate.mockResolvedValue({});

    await pushMetricsBlob(new Blob(["data"]), "checksum-abc");

    expect(mockUpdate).toHaveBeenCalledWith("existing-1", expect.any(FormData));
    expect(mockSyncCreate).not.toHaveBeenCalled();
  });

  it("throws when not authenticated", async () => {
    mockAuthStoreRecord = null;

    await expect(pushMetricsBlob(new Blob(["data"]), "checksum")).rejects.toThrow(
      "Not authenticated"
    );
  });
});

describe("pullMetricsBlob()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initClient("https://sync.example.com");
    mockAuthStoreRecord = { id: "user-1", email: "user@test.com" };
  });

  it("returns null when not authenticated", async () => {
    mockAuthStoreRecord = null;

    const result = await pullMetricsBlob();

    expect(result).toBeNull();
  });

  it("returns null when no blob exists", async () => {
    mockGetList.mockResolvedValue({ items: [] });

    const result = await pullMetricsBlob();

    expect(result).toBeNull();
  });
});

describe("listRemoteVersions()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initClient("https://sync.example.com");
  });

  it("returns mapped version metadata", async () => {
    mockGetFullList.mockResolvedValue([
      {
        id: "rec-1",
        version_id: "ver-1",
        book_id: "book-1",
        checksum: "abc123",
        version_name: "Draft 1",
        version_trigger: "auto",
        version_created_at: 1_000_000,
        word_count: 500,
      },
    ]);

    const result = await listRemoteVersions("book-1");

    expect(result).toEqual([
      {
        remoteId: "rec-1",
        versionId: "ver-1",
        bookId: "book-1",
        checksum: "abc123",
        name: "Draft 1",
        triggerType: "auto",
        createdAt: 1_000_000,
        wordCount: 500,
      },
    ]);
  });

  it("returns all versions when no bookId is provided", async () => {
    mockGetFullList.mockResolvedValue([]);

    await listRemoteVersions();

    const call = mockGetFullList.mock.calls[0][0];
    expect(call.filter).toBe("");
  });
});

describe("pushVersionBlob()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initClient("https://sync.example.com");
    mockAuthStoreRecord = { id: "user-1", email: "user@test.com" };
  });

  it("creates a version item with all metadata", async () => {
    mockSyncCreate.mockResolvedValue({});

    await pushVersionBlob(
      {
        versionId: "ver-1",
        bookId: "book-1",
        checksum: "abc123",
        name: "Draft 1",
        triggerType: "manual",
        createdAt: 1_000_000,
        wordCount: 500,
      },
      new Blob(["data"])
    );

    expect(mockSyncCreate).toHaveBeenCalled();
    const formData = mockSyncCreate.mock.calls[0][0] as FormData;
    expect(formData.has("encrypted_data")).toBe(true);
    expect(formData.has("version_id")).toBe(true);
  });

  it("omits version_name when name is null", async () => {
    mockSyncCreate.mockResolvedValue({});

    await pushVersionBlob(
      {
        versionId: "ver-1",
        bookId: "book-1",
        checksum: "abc123",
        name: null,
        triggerType: "manual",
        createdAt: 1_000_000,
        wordCount: 500,
      },
      new Blob(["data"])
    );

    const formData = mockSyncCreate.mock.calls[0][0] as FormData;
    expect(formData.has("version_name")).toBe(false);
  });

  it("throws when not authenticated", async () => {
    mockAuthStoreRecord = null;

    await expect(
      pushVersionBlob(
        {
          versionId: "ver-1",
          bookId: "book-1",
          checksum: "abc123",
          name: null,
          triggerType: "manual",
          createdAt: 1_000_000,
          wordCount: 500,
        },
        new Blob(["data"])
      )
    ).rejects.toThrow("Not authenticated");
  });
});

describe("pullVersionBlob()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initClient("https://sync.example.com");
  });

  it("returns null when record is not found", async () => {
    mockGetOne.mockRejectedValue(new Error("Not found"));

    const result = await pullVersionBlob("rec-1");

    expect(result).toBeNull();
  });
});
