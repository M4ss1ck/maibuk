// The conformance build's config override (#447, D5). The native build merges
// `--config` over `src-tauri/tauri.conf.json`; the lane's override gives the
// build a separate identifier and product name so it stays off the author's
// Library, and lets the main document reach the collector.
//
// The CSP rule is narrow on purpose: add the collector origin to the app
// document's `connect-src` and change nothing else. The sandbox frame/Worker CSP
// lives in `sandbox.ts`, not in `tauri.conf.json`, so it is untouched (D3). The
// repository's app CSP is currently `null` (no CSP is injected), and the collector
// is already reachable then; `cspWithCollectorConnectSrc` returns `null` rather
// than inventing a restrictive policy that would also fence off Tauri's own IPC.

/** The origin the collector binds and the fixture's escapes target. */
export const CONFORMANCE_COLLECTOR_ORIGIN = "http://127.0.0.1:8787";

/** The identifier the conformance build uses, off the author's install. */
export const CONFORMANCE_IDENTIFIER = "com.massick.maibuk.conformance";

/** The product name the conformance build uses. */
export const CONFORMANCE_PRODUCT_NAME = "maibuk-conformance";

/** The identifier the Plugins bench WebKitGTK build uses (#448, unit 4b). */
export const BENCH_IDENTIFIER = "com.massick.maibuk.bench";

/** The product name the Plugins bench WebKitGTK build uses. */
export const BENCH_PRODUCT_NAME = "maibuk-bench";

/**
 * The app document's CSP with `origin` added to its `connect-src`, and every
 * other directive kept verbatim. A `null`/empty CSP stays `null`: there is
 * nothing to extend and no CSP means the collector is already reachable.
 */
export function cspWithCollectorConnectSrc(
  baseCsp: string | null | undefined,
  origin: string = CONFORMANCE_COLLECTOR_ORIGIN
): string | null {
  if (baseCsp === null || baseCsp === undefined || baseCsp.trim() === "") return null;
  const directives = baseCsp
    .split(";")
    .map((directive) => directive.trim())
    .filter((directive) => directive !== "");

  let found = false;
  const merged = directives.map((directive) => {
    const tokens = directive.split(/\s+/);
    if (tokens[0] !== "connect-src") return directive;
    found = true;
    return tokens.includes(origin) ? directive : `${directive} ${origin}`;
  });
  if (!found) merged.push(`connect-src 'self' ${origin}`);
  return merged.join("; ");
}

/** The `app.security.csp` of a parsed `tauri.conf.json`, or `null`. */
function baseCspOf(baseConfig: unknown): string | null {
  const security = (baseConfig as { app?: { security?: { csp?: unknown } } } | null)?.app?.security;
  return typeof security?.csp === "string" ? security.csp : null;
}

/** The `--config` override the Linux conformance build is given. */
export function conformanceConfigOverride(baseConfig: unknown): {
  identifier: string;
  productName: string;
  app: { security: { csp: string | null } };
} {
  return {
    identifier: CONFORMANCE_IDENTIFIER,
    productName: CONFORMANCE_PRODUCT_NAME,
    app: { security: { csp: cspWithCollectorConnectSrc(baseCspOf(baseConfig)) } },
  };
}

/**
 * The `--config` override the Plugins bench WebKitGTK build is given (#448,
 * unit 4b): its own identifier and product name, so it never touches the
 * author's install (or a conformance install). The app CSP stays the base's;
 * the bench collector is reached on `127.0.0.1` under no CSP, like conformance.
 */
export function benchConfigOverride(baseConfig: unknown): {
  identifier: string;
  productName: string;
  app: { security: { csp: string | null } };
} {
  return {
    identifier: BENCH_IDENTIFIER,
    productName: BENCH_PRODUCT_NAME,
    app: { security: { csp: cspWithCollectorConnectSrc(baseCspOf(baseConfig)) } },
  };
}
