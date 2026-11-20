import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The suite assumes one Node major (vite.config.ts passes Node 26 flags), so
// every place that picks a Node reads the same pin: the shell's version
// manager and CI read .node-version, pnpm reads devEngines.runtime and runs
// scripts on the lockfile's Node even when the shell's `node` is older.
const pinned = readFileSync(".node-version", "utf8").trim();
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
  devEngines?: { runtime?: { name?: string; version?: string; onFail?: string } };
};
const workflows = readdirSync(".github/workflows")
  .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
  .map((name) => ({ name, text: readFileSync(`.github/workflows/${name}`, "utf8") }));

describe("Node version pin", () => {
  it("pins a single major in .node-version", () => {
    expect(pinned).toMatch(/^\d+$/);
  });

  it("has pnpm download the same Node for every script", () => {
    expect(pkg.devEngines?.runtime).toEqual({ name: "node", version: pinned, onFail: "download" });
  });

  it("locks the downloaded Node in pnpm-lock.yaml", () => {
    const lock = readFileSync("pnpm-lock.yaml", "utf8");
    expect(lock).toContain(`specifier: runtime:${pinned}`);
    expect(lock).toMatch(new RegExp(`version: runtime:${pinned}\\.\\d+\\.\\d+`));
  });

  it("finds the workflows that set up Node", () => {
    expect(workflows.filter((w) => w.text.includes("actions/setup-node")).length).toBeGreaterThan(
      0
    );
  });

  it.each(
    workflows.map((w) => [w.name, w.text] as const)
  )("%s sets up Node from .node-version only", (_name, text) => {
    const count = (needle: string) => text.split(needle).length - 1;
    expect(count('node-version-file: ".node-version"')).toBe(count("uses: actions/setup-node@"));
    expect(text).not.toMatch(/\bnode-version:/);
  });
});
