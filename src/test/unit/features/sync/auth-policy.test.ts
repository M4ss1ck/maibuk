import { describe, expect, it } from "vitest";
import {
  AUTH_EXPIRY_MARGIN_MS,
  AUTH_REFRESH_INTERVAL_MS,
  getTokenExpiryMs,
  shouldRefreshAuth,
} from "@/features/sync/auth-policy";
import { buildTestJwt } from "@/test/support/jwt";

const NOW = Date.UTC(2026, 8, 12, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

describe("getTokenExpiryMs()", () => {
  it("reads exp as epoch milliseconds", () => {
    expect(getTokenExpiryMs(buildTestJwt(NOW + 7 * DAY))).toBe(NOW + 7 * DAY);
  });

  it("returns null for a missing or unreadable token", () => {
    expect(getTokenExpiryMs(null)).toBeNull();
    expect(getTokenExpiryMs("not-a-jwt")).toBeNull();
  });
});

describe("shouldRefreshAuth()", () => {
  const fresh = buildTestJwt(NOW + 7 * DAY);

  it("refreshes a session the server has not confirmed since launch", () => {
    expect(
      shouldRefreshAuth({ token: fresh, authVerified: false, refreshedAt: null, now: NOW })
    ).toBe(true);
  });

  it("does nothing without a token once verified", () => {
    expect(shouldRefreshAuth({ token: null, authVerified: true, refreshedAt: NOW, now: NOW })).toBe(
      false
    );
  });

  it("skips a fresh, recently renewed token", () => {
    expect(
      shouldRefreshAuth({ token: fresh, authVerified: true, refreshedAt: NOW - DAY / 4, now: NOW })
    ).toBe(false);
  });

  it("renews once the refresh interval has elapsed, even with days left", () => {
    expect(
      shouldRefreshAuth({
        token: fresh,
        authVerified: true,
        refreshedAt: NOW - AUTH_REFRESH_INTERVAL_MS,
        now: NOW,
      })
    ).toBe(true);
  });

  // The reported bug: verified at launch, then the app stayed open until the
  // token was about to lapse. Verification alone must not suppress renewal.
  it("renews a verified token that is inside the expiry margin", () => {
    const expiring = buildTestJwt(NOW + AUTH_EXPIRY_MARGIN_MS - 1000);
    expect(
      shouldRefreshAuth({ token: expiring, authVerified: true, refreshedAt: null, now: NOW })
    ).toBe(true);
  });

  it("renews (so the server can reject) a token that already expired", () => {
    const expired = buildTestJwt(NOW - DAY);
    expect(
      shouldRefreshAuth({ token: expired, authVerified: true, refreshedAt: NOW, now: NOW })
    ).toBe(true);
  });

  it("lets the server judge a token whose expiry cannot be read", () => {
    expect(
      shouldRefreshAuth({ token: "opaque", authVerified: true, refreshedAt: NOW, now: NOW })
    ).toBe(true);
  });

  it("relies on the expiry alone when no refresh happened this launch", () => {
    expect(
      shouldRefreshAuth({ token: fresh, authVerified: true, refreshedAt: null, now: NOW })
    ).toBe(false);
  });
});
