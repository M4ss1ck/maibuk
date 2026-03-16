import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockAuthRefresh } = vi.hoisted(() => ({
  mockAuthRefresh: vi.fn(),
}));

let mockAuthStoreToken = "refreshed-token";

vi.mock("pocketbase", () => {
  return {
    default: class MockPocketBase {
      authStore = {
        save: vi.fn(),
        clear: vi.fn(),
        get token() {
          return mockAuthStoreToken;
        },
        record: null as { id: string; email: string } | null,
        get isValid() {
          return true;
        },
      };
      collection = vi.fn(() => ({
        authRefresh: mockAuthRefresh,
      }));
      files = { getURL: vi.fn() };
    },
  };
});

const { initClient, refreshAuth, parsePocketBaseDate } = await import(
  "../../../../features/sync/client"
);

describe("parsePocketBaseDate()", () => {
  it("parses standard ISO 8601 dates", () => {
    expect(parsePocketBaseDate("2024-01-15T10:30:00.000Z")).toBe(
      Math.floor(new Date("2024-01-15T10:30:00.000Z").getTime() / 1000),
    );
  });

  it("parses PocketBase space-separated dates", () => {
    // PocketBase returns "2024-01-15 10:30:00.000Z" (space instead of T)
    expect(parsePocketBaseDate("2024-01-15 10:30:00.000Z")).toBe(
      Math.floor(new Date("2024-01-15T10:30:00.000Z").getTime() / 1000),
    );
  });

  it("parses dates without timezone suffix as UTC", () => {
    // Some PocketBase configs omit the Z
    expect(parsePocketBaseDate("2024-01-15 10:30:00.000")).toBe(
      Math.floor(new Date("2024-01-15T10:30:00.000Z").getTime() / 1000),
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
