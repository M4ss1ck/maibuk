import { describe, expect, it } from "vitest";

import {
  CONFORMANCE_COLLECTOR_ORIGIN,
  CONFORMANCE_IDENTIFIER,
  CONFORMANCE_PRODUCT_NAME,
  conformanceConfigOverride,
  cspWithCollectorConnectSrc,
} from "@/test/support/plugin-conformance/csp";

describe("cspWithCollectorConnectSrc()", () => {
  it("adds the collector to an existing connect-src and keeps every other directive", () => {
    const base = "default-src 'self'; connect-src 'self' ipc: http://ipc.localhost; img-src data:";
    expect(cspWithCollectorConnectSrc(base)).toBe(
      `default-src 'self'; connect-src 'self' ipc: http://ipc.localhost ${CONFORMANCE_COLLECTOR_ORIGIN}; img-src data:`
    );
  });

  it("leaves an already-allowed collector untouched", () => {
    const base = `connect-src 'self' ${CONFORMANCE_COLLECTOR_ORIGIN}`;
    expect(cspWithCollectorConnectSrc(base)).toBe(base);
  });

  it("adds a connect-src when the policy has none", () => {
    expect(cspWithCollectorConnectSrc("default-src 'self'")).toBe(
      `default-src 'self'; connect-src 'self' ${CONFORMANCE_COLLECTOR_ORIGIN}`
    );
  });

  it("keeps a null or empty CSP null: nothing to extend, the collector is already reachable", () => {
    expect(cspWithCollectorConnectSrc(null)).toBeNull();
    expect(cspWithCollectorConnectSrc(undefined)).toBeNull();
    expect(cspWithCollectorConnectSrc("   ")).toBeNull();
  });
});

describe("conformanceConfigOverride()", () => {
  it("gives the build its own identifier and product name", () => {
    const override = conformanceConfigOverride({ app: { security: { csp: null } } });
    expect(override.identifier).toBe(CONFORMANCE_IDENTIFIER);
    expect(override.productName).toBe(CONFORMANCE_PRODUCT_NAME);
  });

  it("keeps the repository's null CSP null", () => {
    expect(conformanceConfigOverride({ app: { security: { csp: null } } }).app.security.csp).toBeNull();
  });

  it("extends a string CSP with the collector", () => {
    const override = conformanceConfigOverride({ app: { security: { csp: "default-src 'self'" } } });
    expect(override.app.security.csp).toBe(
      `default-src 'self'; connect-src 'self' ${CONFORMANCE_COLLECTOR_ORIGIN}`
    );
  });

  it("tolerates a config with no app.security.csp", () => {
    expect(conformanceConfigOverride({}).app.security.csp).toBeNull();
  });
});
