function base64Url(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** An unsigned JWT-shaped token carrying `exp`, readable by pocketbase's getTokenPayload. */
export function buildTestJwt(expiresAtMs: number): string {
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({ exp: Math.floor(expiresAtMs / 1000), type: "auth", refreshable: true })
  );
  return `${header}.${payload}.signature`;
}
