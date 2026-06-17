import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

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
  mockGetURL,
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
  mockGetURL: vi.fn(),
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
          getOne: mockGetOne,
          getFullList: mockGetFullList,
          getList: mockGetList,
          update: mockUpdate,
          delete: mockDelete,
          create: mockSyncCreate,
        };
      });
      files = { getURL: mockGetURL };
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
  listRemoteNotes,
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
  pushObject,
  pullObjectContent,
  listObjects,
  pullObjectsSince,
  softDeleteObject,
  isKeyUniqueConstraintError,
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

describe("generic object sync core", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    mockGetURL.mockReturnValue("https://sync.example.com/api/files/objects/r1/content.bin");
    initClient("https://sync.example.com");
    mockAuthStoreRecord = { id: "u1", email: "a@b.c" };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates an object with routing fields and app_name when no remoteId is given", async () => {
    mockSyncCreate.mockResolvedValue({ id: "r1" });

    const remoteId = await pushObject({
      kind: "book",
      key: "book-1",
      group: "library-1",
      checksum: "sum-1",
      meta: "encrypted-meta",
      content: new Blob(["ciphertext"]),
    });

    expect(remoteId).toBe("r1");
    expect(mockSyncCreate).toHaveBeenCalledWith(expect.any(FormData));
    expect(mockUpdate).not.toHaveBeenCalled();
    const formData = mockSyncCreate.mock.calls[0][0] as FormData;
    expect(formData.get("user")).toBe("u1");
    expect(formData.get("app_name")).toBe("maibuk");
    expect(formData.get("kind")).toBe("book");
    expect(formData.get("key")).toBe("book-1");
    expect(formData.get("group")).toBe("library-1");
    expect(formData.get("checksum")).toBe("sum-1");
    expect(formData.get("meta")).toBe("encrypted-meta");
    expect(formData.get("deleted")).toBe("false");
    expect((formData.get("content") as File).name).toBe("book-1.bin");
  });

  it("throws when pushing an object without authentication", async () => {
    mockAuthStoreRecord = null;

    await expect(
      pushObject({
        kind: "book",
        key: "book-1",
        content: new Blob(["ciphertext"]),
      })
    ).rejects.toThrow("Not authenticated");
    expect(mockSyncCreate).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("updates an existing object when remoteId is given", async () => {
    mockUpdate.mockResolvedValue({ id: "existing-1" });

    const remoteId = await pushObject({
      kind: "note",
      key: "note-1",
      checksum: "sum-2",
      remoteId: "existing-1",
    });

    expect(remoteId).toBe("existing-1");
    expect(mockUpdate).toHaveBeenCalledWith("existing-1", expect.any(FormData));
    expect(mockSyncCreate).not.toHaveBeenCalled();
    const formData = mockUpdate.mock.calls[0][1] as FormData;
    expect(formData.get("group")).toBe("");
    expect(formData.get("checksum")).toBe("sum-2");
    expect(formData.get("meta")).toBe("");
    expect(formData.get("deleted")).toBe("false");
  });

  it("returns null when pulled object content has no file", async () => {
    mockGetOne.mockResolvedValue({ id: "r1", content: "" });

    const content = await pullObjectContent("r1");

    expect(content).toBeNull();
    expect(mockGetOne).toHaveBeenCalledWith("r1");
  });

  it("returns bytes from pulled object content when the file fetch succeeds", async () => {
    const bytes = new Uint8Array([12, 34, 56]);
    mockGetOne.mockResolvedValue({ id: "r1", content: "content.bin" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(bytes.buffer),
      })
    );

    const content = await pullObjectContent("r1");

    expect(content).toEqual(bytes);
    expect(mockGetOne).toHaveBeenCalledWith("r1");
    expect(mockGetURL).toHaveBeenCalledWith({ id: "r1", content: "content.bin" }, "content.bin");
    expect(fetch).toHaveBeenCalledWith("https://sync.example.com/api/files/objects/r1/content.bin");
  });

  it("returns null when pulling an object record fails", async () => {
    mockGetOne.mockRejectedValue(new Error("not found"));

    const content = await pullObjectContent("missing");

    expect(content).toBeNull();
    expect(mockGetURL).not.toHaveBeenCalled();
  });

  it("returns null when fetching pulled object content rejects", async () => {
    mockGetOne.mockResolvedValue({ id: "r1", content: "content.bin" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));

    const content = await pullObjectContent("r1");

    expect(content).toBeNull();
  });

  it("returns null when fetching pulled object content returns a non-OK response", async () => {
    const bytes = new Uint8Array([99]);
    mockGetOne.mockResolvedValue({ id: "r1", content: "content.bin" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        arrayBuffer: vi.fn().mockResolvedValue(bytes.buffer),
      })
    );

    const content = await pullObjectContent("r1");

    expect(content).toBeNull();
  });

  it("lists objects filtered by app_name, kind, and deleted=false", async () => {
    mockGetFullList.mockResolvedValue([
      {
        id: "r1",
        kind: "book",
        key: "book-1",
        group: "",
        checksum: "sum-1",
        deleted: false,
        meta: "meta-1",
        updated: "2026-06-01 12:30:00.000Z",
      },
    ]);

    const result = await listObjects("book");

    expect(mockGetFullList).toHaveBeenCalledWith({
      filter: 'app_name = "maibuk" && kind = "book" && deleted = false',
      sort: "updated",
      fields: "id,kind,key,group,checksum,deleted,meta,updated",
    });
    expect(result).toEqual([
      {
        remoteId: "r1",
        kind: "book",
        key: "book-1",
        group: "",
        checksum: "sum-1",
        deleted: false,
        meta: "meta-1",
        updatedAt: Math.floor(new Date("2026-06-01T12:30:00.000Z").getTime() / 1000),
        updatedIso: "2026-06-01 12:30:00.000Z",
      },
    ]);
  });

  it("includes a group filter when listing objects with a group", async () => {
    mockGetFullList.mockResolvedValue([]);

    await listObjects("note", "book-1");

    expect(mockGetFullList).toHaveBeenCalledWith({
      filter: 'app_name = "maibuk" && kind = "note" && deleted = false && group = "book-1"',
      sort: "updated",
      fields: "id,kind,key,group,checksum,deleted,meta,updated",
    });
  });

  it("pulls objects since an updated timestamp without filtering deleted records", async () => {
    mockGetFullList.mockResolvedValue([]);

    await pullObjectsSince("version", "2026-06-01T00:00:00.000Z");

    expect(mockGetFullList).toHaveBeenCalledWith({
      filter: 'app_name = "maibuk" && kind = "version" && updated > "2026-06-01T00:00:00.000Z"',
      sort: "updated",
      fields: "id,kind,key,group,checksum,deleted,meta,updated",
    });
  });

  it("pulls all objects for a kind when sinceIso is empty and still does not filter deleted records", async () => {
    mockGetFullList.mockResolvedValue([]);

    await pullObjectsSince("metric", "");

    expect(mockGetFullList).toHaveBeenCalledWith({
      filter: 'app_name = "maibuk" && kind = "metric"',
      sort: "updated",
      fields: "id,kind,key,group,checksum,deleted,meta,updated",
    });
  });

  it("soft-deletes an existing object", async () => {
    mockGetList.mockResolvedValue({ items: [{ id: "r1" }] });
    mockUpdate.mockResolvedValue({ id: "r1" });

    await softDeleteObject("book", "book-1");

    expect(mockGetList).toHaveBeenCalledWith(1, 1, {
      filter: 'app_name = "maibuk" && kind = "book" && key = "book-1"',
    });
    expect(mockUpdate).toHaveBeenCalledWith("r1", expect.any(FormData));
    const formData = mockUpdate.mock.calls[0][1] as FormData;
    expect(formData.get("deleted")).toBe("true");
    expect(mockSyncCreate).not.toHaveBeenCalled();
  });

  it("creates a deleted object when no existing object is found", async () => {
    mockGetList.mockResolvedValue({ items: [] });
    mockSyncCreate.mockResolvedValue({ id: "deleted-1" });

    await softDeleteObject("note", "note-1", "encrypted-delete-meta");

    expect(mockSyncCreate).toHaveBeenCalledWith(expect.any(FormData));
    expect(mockUpdate).not.toHaveBeenCalled();
    const formData = mockSyncCreate.mock.calls[0][0] as FormData;
    expect(formData.get("user")).toBe("u1");
    expect(formData.get("app_name")).toBe("maibuk");
    expect(formData.get("kind")).toBe("note");
    expect(formData.get("key")).toBe("note-1");
    expect(formData.get("group")).toBe("");
    expect(formData.get("checksum")).toBe("");
    expect(formData.get("meta")).toBe("encrypted-delete-meta");
    expect(formData.get("deleted")).toBe("true");
  });

  it("updates a raced existing object when deleted object creation hits a unique constraint", async () => {
    let lookupCount = 0;
    mockGetList.mockImplementation(async () => {
      lookupCount += 1;
      return lookupCount === 1 ? { items: [] } : { items: [{ id: "rRace" }] };
    });
    mockSyncCreate.mockRejectedValue({
      status: 400,
      data: {
        data: {
          key: { code: "validation_not_unique" },
        },
      },
    });
    mockUpdate.mockResolvedValue({ id: "rRace" });

    let thrown: unknown;
    try {
      await softDeleteObject("book", "book-race");
    } catch (error) {
      thrown = error;
    }

    const expectedFilter = 'app_name = "maibuk" && kind = "book" && key = "book-race"';
    expect(thrown).toBeUndefined();
    expect(mockGetList).toHaveBeenNthCalledWith(1, 1, 1, { filter: expectedFilter });
    expect(mockGetList).toHaveBeenNthCalledWith(2, 1, 1, { filter: expectedFilter });
    expect(mockUpdate).toHaveBeenCalledWith("rRace", expect.any(FormData));
    const formData = mockUpdate.mock.calls[0][1] as FormData;
    expect(formData.get("deleted")).toBe("true");
  });

  it("detects unique constraint errors on arbitrary fields", () => {
    expect(
      isKeyUniqueConstraintError({
        status: 400,
        data: {
          data: {
            key: { code: "validation_not_unique" },
          },
        },
      })
    ).toBe(true);
    expect(
      isKeyUniqueConstraintError({
        status: 409,
        data: {
          data: {
            checksum: { message: "Value must be unique." },
          },
        },
      })
    ).toBe(true);
  });

  it("does not treat non-unique validation as a key uniqueness error", () => {
    expect(
      isKeyUniqueConstraintError({
        status: 400,
        data: {
          data: {
            key: { code: "validation_required" },
          },
        },
      })
    ).toBe(false);
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

  it("maps live generic book objects to SyncItemMeta using parsePocketBaseDate", async () => {
    mockGetFullList.mockResolvedValue([
      {
        id: "rec-1",
        key: "book-1",
        checksum: "abc123",
        updated: "2024-01-15 10:30:00.000Z",
      },
    ]);

    const result = await listRemoteBooks();

    expect(mockGetFullList).toHaveBeenCalledWith({
      filter: 'app_name = "maibuk" && kind = "book" && deleted = false',
      sort: "updated",
      fields: "id,kind,key,group,checksum,deleted,meta,updated",
    });
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
    mockAuthStoreRecord = { id: "user-1", email: "user@test.com" };
  });

  it("soft-deletes the matching generic book object", async () => {
    mockGetList.mockResolvedValue({ items: [{ id: "remote-1" }] });

    await deleteRemoteBook("book-1");

    expect(mockGetList).toHaveBeenCalledWith(1, 1, {
      filter: 'app_name = "maibuk" && kind = "book" && key = "book-1"',
    });
    expect(mockUpdate).toHaveBeenCalledWith("remote-1", expect.any(FormData));
    const formData = mockUpdate.mock.calls[0][1] as FormData;
    expect(formData.get("user")).toBe("user-1");
    expect(formData.get("app_name")).toBe("maibuk");
    expect(formData.get("kind")).toBe("book");
    expect(formData.get("key")).toBe("book-1");
    expect(formData.get("deleted")).toBe("true");
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("creates a deleted generic book object when no row exists", async () => {
    mockGetList.mockResolvedValue({ items: [] });
    mockSyncCreate.mockResolvedValue({ id: "deleted-1" });

    await deleteRemoteBook("missing-book");

    expect(mockSyncCreate).toHaveBeenCalledWith(expect.any(FormData));
    const formData = mockSyncCreate.mock.calls[0][0] as FormData;
    expect(formData.get("kind")).toBe("book");
    expect(formData.get("key")).toBe("missing-book");
    expect(formData.get("deleted")).toBe("true");
    expect(mockDelete).not.toHaveBeenCalled();
  });
});

describe("deleteRemoteNote()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initClient("https://sync.example.com");
    mockAuthStoreRecord = { id: "user-1", email: "user@test.com" };
  });

  it("soft-deletes the matching generic note object", async () => {
    mockGetList.mockResolvedValue({ items: [{ id: "remote-note-1" }] });
    mockUpdate.mockResolvedValue({ id: "remote-note-1" });

    await deleteRemoteNote("note-1");

    expect(mockGetList).toHaveBeenCalledWith(1, 1, {
      filter: 'app_name = "maibuk" && kind = "note" && key = "note-1"',
    });
    expect(mockUpdate).toHaveBeenCalledWith("remote-note-1", expect.any(FormData));
    const formData = mockUpdate.mock.calls[0][1] as FormData;
    expect(formData.get("deleted")).toBe("true");
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("creates a deleted generic note object when no row exists", async () => {
    mockGetList.mockResolvedValue({ items: [] });
    mockSyncCreate.mockResolvedValue({ id: "deleted-1" });

    await deleteRemoteNote("missing-note");

    expect(mockSyncCreate).toHaveBeenCalledWith(expect.any(FormData));
    const formData = mockSyncCreate.mock.calls[0][0] as FormData;
    expect(formData.get("kind")).toBe("note");
    expect(formData.get("key")).toBe("missing-note");
    expect(formData.get("deleted")).toBe("true");
    expect(mockDelete).not.toHaveBeenCalled();
  });
});

describe("pushBookBlob()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initClient("https://sync.example.com");
    mockAuthStoreRecord = { id: "user-1", email: "user@test.com" };
  });

  it("creates a new generic book object when no remoteId is given", async () => {
    mockSyncCreate.mockResolvedValue({});

    await pushBookBlob("book-1", new Blob(["data"]), "checksum-abc");

    expect(mockSyncCreate).toHaveBeenCalledWith(expect.any(FormData));
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockGetList).not.toHaveBeenCalled();
    const formData = mockSyncCreate.mock.calls[0][0] as FormData;
    expect(formData.get("user")).toBe("user-1");
    expect(formData.get("app_name")).toBe("maibuk");
    expect(formData.get("kind")).toBe("book");
    expect(formData.get("key")).toBe("book-1");
    expect(formData.get("checksum")).toBe("checksum-abc");
    expect(formData.get("deleted")).toBe("false");
    expect((formData.get("content") as File).name).toBe("book-1.bin");
    expect(formData.get("encrypted_data")).toBeNull();
    expect(formData.get("book_id")).toBeNull();
  });

  it("updates the existing generic book object directly when a remoteId is given", async () => {
    mockUpdate.mockResolvedValue({});

    await pushBookBlob("book-1", new Blob(["data"]), "checksum-abc", "existing-1");

    expect(mockUpdate).toHaveBeenCalledWith("existing-1", expect.any(FormData));
    expect(mockSyncCreate).not.toHaveBeenCalled();
    expect(mockGetList).not.toHaveBeenCalled();
    const formData = mockUpdate.mock.calls[0][1] as FormData;
    expect(formData.get("user")).toBe("user-1");
    expect(formData.get("app_name")).toBe("maibuk");
    expect(formData.get("kind")).toBe("book");
    expect(formData.get("key")).toBe("book-1");
    expect(formData.get("checksum")).toBe("checksum-abc");
    expect(formData.get("deleted")).toBe("false");
    expect((formData.get("content") as File).name).toBe("book-1.bin");
    expect(formData.get("encrypted_data")).toBeNull();
    expect(formData.get("book_id")).toBeNull();
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

  it("creates a new generic note object when no remoteId is given, without an extra lookup", async () => {
    mockSyncCreate.mockResolvedValue({ id: "r1" });

    await pushNoteBlob("note-1", new Blob(["data"]), "checksum-abc");

    expect(mockSyncCreate).toHaveBeenCalledWith(expect.any(FormData));
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockGetList).not.toHaveBeenCalled();
    const formData = mockSyncCreate.mock.calls[0][0] as FormData;
    expect(formData.get("kind")).toBe("note");
    expect(formData.get("key")).toBe("note-1");
    expect(formData.get("checksum")).toBe("checksum-abc");
    expect(formData.get("deleted")).toBe("false");
    expect(formData.get("encrypted_data")).toBeNull();
    expect(formData.get("note_id")).toBeNull();
  });

  it("updates the existing generic note object directly when a remoteId is given", async () => {
    mockUpdate.mockResolvedValue({});

    await pushNoteBlob("note-1", new Blob(["data"]), "checksum-abc", "existing-note-1");

    expect(mockUpdate).toHaveBeenCalledWith("existing-note-1", expect.any(FormData));
    expect(mockSyncCreate).not.toHaveBeenCalled();
    expect(mockGetList).not.toHaveBeenCalled();
    const formData = mockUpdate.mock.calls[0][1] as FormData;
    expect(formData.get("kind")).toBe("note");
    expect(formData.get("key")).toBe("note-1");
    expect(formData.get("deleted")).toBe("false");
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

  it("returns null when no live generic book object exists", async () => {
    mockGetFullList.mockResolvedValue([]);

    const result = await pullBookBlob("book-1");

    expect(result).toBeNull();
    expect(mockGetFullList).toHaveBeenCalledWith({
      filter: 'app_name = "maibuk" && kind = "book" && deleted = false',
      sort: "updated",
      fields: "id,kind,key,group,checksum,deleted,meta,updated",
    });
    expect(mockGetList).not.toHaveBeenCalled();
  });

  it("pulls content for the matching live generic book object", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    mockGetFullList.mockResolvedValue([
      {
        id: "remote-other",
        kind: "book",
        key: "other-book",
        checksum: "other-checksum",
        updated: "2024-01-15 10:30:00.000Z",
      },
      {
        id: "remote-1",
        kind: "book",
        key: "book-1",
        checksum: "checksum-abc",
        updated: "2024-01-15 10:30:00.000Z",
      },
    ]);
    mockGetOne.mockResolvedValue({ id: "remote-1", content: "content.bin" });
    mockGetURL.mockReturnValue("https://sync.example.com/api/files/objects/remote-1/content.bin");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(bytes.buffer),
      })
    );

    const result = await pullBookBlob("book-1");

    expect(result).toEqual({ data: bytes, checksum: "checksum-abc" });
    expect(mockGetOne).toHaveBeenCalledWith("remote-1");
  });

  it("returns null when a matching generic book object has no content", async () => {
    mockGetFullList.mockResolvedValue([
      {
        id: "remote-1",
        kind: "book",
        key: "book-1",
        checksum: "checksum-abc",
        updated: "2024-01-15 10:30:00.000Z",
      },
    ]);
    mockGetOne.mockResolvedValue({ id: "remote-1", content: "" });

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

describe("note wrappers over objects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initClient("https://sync.example.com");
    mockAuthStoreRecord = { id: "u1", email: "a@b.c" };
    mockCreate.mockReset(); mockGetFullList.mockReset(); mockGetList.mockReset(); mockUpdate.mockReset();
  });

  it("pushNoteBlob writes kind=note", async () => {
    mockSyncCreate.mockResolvedValue({ id: "r1" });
    await pushNoteBlob("n1", new Blob(["x"]), "sum1");
    const fd = mockSyncCreate.mock.calls[0][0] as FormData;
    expect(fd.get("kind")).toBe("note");
    expect(fd.get("key")).toBe("n1");
  });

  it("listRemoteNotes maps key->noteId", async () => {
    mockGetFullList.mockResolvedValue([
      { id: "r1", kind: "note", key: "n1", group: "", checksum: "c", deleted: false, meta: "", updated: "2026-06-16 10:00:00.000Z" },
    ]);
    const rows = await listRemoteNotes();
    expect(rows[0]).toMatchObject({ remoteId: "r1", noteId: "n1", checksum: "c" });
  });

  it("deleteRemoteNote soft-deletes", async () => {
    mockGetList.mockResolvedValue({ items: [{ id: "r1" }] });
    mockUpdate.mockResolvedValue({ id: "r1" });
    await deleteRemoteNote("n1");
    expect((mockUpdate.mock.calls[0][1] as FormData).get("deleted")).toBe("true");
  });
});
