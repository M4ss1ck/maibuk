// When to renew the PocketBase auth token. PocketBase has no refresh tokens:
// authRefresh only works while the current token is still valid (users tokens
// live 7 days by default), so the session survives only if the app renews it
// well before `exp`. Pure and clock-injected so the policy is unit-testable.
import { getTokenPayload } from "pocketbase";

/** Renew at most this often while the app stays open (tray, sleep, long sessions). */
export const AUTH_REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000;
/** Always renew once the token is this close to expiring. */
export const AUTH_EXPIRY_MARGIN_MS = 24 * 60 * 60 * 1000;
/** How often the keep-alive re-evaluates the policy. */
export const AUTH_CHECK_INTERVAL_MS = 15 * 60 * 1000;

/** Token `exp` in epoch milliseconds, or null when the token has no readable expiry. */
export function getTokenExpiryMs(token: string | null): number | null {
  if (!token) return null;
  const exp = getTokenPayload(token).exp;
  return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : null;
}

export interface AuthRefreshInput {
  token: string | null;
  /** The server confirmed this session since launch. */
  authVerified: boolean;
  /** Epoch ms of the last successful login or refresh this launch, if any. */
  refreshedAt: number | null;
  now: number;
}

export function shouldRefreshAuth({
  token,
  authVerified,
  refreshedAt,
  now,
}: AuthRefreshInput): boolean {
  // Unverified since launch (offline start, failed launch refresh): the server
  // has to confirm the session before anything relies on it.
  if (!authVerified) return true;
  if (!token) return false;

  // An unreadable token cannot be judged locally; let the server decide.
  const expiresAt = getTokenExpiryMs(token);
  if (expiresAt === null) return true;
  if (expiresAt - now <= AUTH_EXPIRY_MARGIN_MS) return true;

  return refreshedAt !== null && now - refreshedAt >= AUTH_REFRESH_INTERVAL_MS;
}
