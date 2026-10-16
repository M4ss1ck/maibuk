// @vitest-environment node
//
// WebKit has OPFS only in a persistent context: in Playwright's default
// ephemeral context `navigator.storage.getDirectory()` throws UnknownError,
// as in a Safari Private window (#479). The E2E `test` fixture asks
// `needsPersistentContext` which context a test gets, so this pins the rule:
// only a WebKit test that seeds the web Plugin Directory gets a persistent one.

import { describe, expect, it } from "vitest";
import { needsPersistentContext } from "../../../e2e/support/storage";

describe("needsPersistentContext", () => {
  it("gives a WebKit test that seeds approved Plugins a persistent context", () => {
    expect(
      needsPersistentContext({ browserName: "webkit", plugins: ["tracer"], unapprovedPlugins: [] })
    ).toBe(true);
  });

  it("gives a WebKit test that seeds only unapproved Plugins a persistent context", () => {
    expect(
      needsPersistentContext({
        browserName: "webkit",
        plugins: [],
        unapprovedPlugins: ["approvals"],
      })
    ).toBe(true);
  });

  it("accepts a Set of seeds, as clonePluginSeeds returns", () => {
    expect(
      needsPersistentContext({
        browserName: "webkit",
        plugins: new Set([{ name: "tracer" as const }]),
        unapprovedPlugins: [],
      })
    ).toBe(true);
  });

  it("gives a WebKit test that installs a Plugin without seeding one a persistent context", () => {
    expect(
      needsPersistentContext({
        browserName: "webkit",
        plugins: [],
        unapprovedPlugins: [],
        usesPluginDirectory: true,
      })
    ).toBe(true);
  });

  it("keeps the default context for a WebKit test that seeds no Plugin", () => {
    expect(
      needsPersistentContext({ browserName: "webkit", plugins: [], unapprovedPlugins: [] })
    ).toBe(false);
  });

  it("keeps the default context on Chromium and Firefox, which have OPFS there", () => {
    for (const browserName of ["chromium", "firefox"] as const) {
      expect(
        needsPersistentContext({
          browserName,
          plugins: ["tracer"],
          unapprovedPlugins: ["approvals"],
        })
      ).toBe(false);
    }
  });
});
