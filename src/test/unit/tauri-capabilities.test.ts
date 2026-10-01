import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function readJson(relative: string): { permissions?: string[] } & Record<string, unknown> {
  return JSON.parse(readFileSync(join(process.cwd(), relative), "utf-8")) as {
    permissions?: string[];
  } & Record<string, unknown>;
}

const FORBIDDEN_SQL_PERMISSIONS = ["sql:default", "sql:allow-load", "sql:allow-close"];

describe("tauri sql capabilities", () => {
  for (const file of [
    "src-tauri/capabilities/desktop.json",
    "src-tauri/capabilities/android.json",
  ]) {
    describe(file, () => {
      it("grants no load or close permission to the webview", () => {
        const capability = readJson(file);
        const permissions = capability.permissions ?? [];

        for (const denied of FORBIDDEN_SQL_PERMISSIONS) {
          expect(permissions).not.toContain(denied);
        }
      });

      it("keeps execute and select for the app-owned Library pool", () => {
        const capability = readJson(file);
        const permissions = capability.permissions ?? [];

        expect(permissions).toContain("sql:allow-execute");
        expect(permissions).toContain("sql:allow-select");
      });
    });
  }

  it("has no sql preload in the Tauri config", () => {
    const config = readJson("src-tauri/tauri.conf.json");
    const plugins = (config.plugins ?? {}) as Record<string, unknown>;

    expect(plugins).not.toHaveProperty("sql");
  });
});
