import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

it("makes downloaded Dictation assets available to the before screenshot build", () => {
  const root = mkdtempSync(join(tmpdir(), "maibuk-screenshot-test-"));
  const repo = join(root, "repo");
  const bin = join(root, "bin");
  const output = join(root, "shots");
  mkdirSync(join(repo, "scripts"), { recursive: true });
  mkdirSync(join(repo, "e2e"));
  mkdirSync(join(repo, "node_modules"));
  mkdirSync(join(repo, "vendor", "moonshine"), { recursive: true });
  mkdirSync(bin);
  copyFileSync(resolve("scripts/pr-screenshots.sh"), join(repo, "scripts/pr-screenshots.sh"));
  writeFileSync(join(repo, "e2e", "fixture"), "tracked fixture");
  writeFileSync(join(repo, ".gitignore"), "vendor/\nnode_modules/\n");
  writeFileSync(join(repo, "vendor", "moonshine", "fixture"), "downloaded runtime");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "pipe" });
  try {
    git("init", "-b", "screenshot-test");
    git("add", "scripts", "e2e", ".gitignore");
    git(
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "-m",
      "fixture"
    );
    writeFileSync(
      join(bin, "pnpm"),
      `#!/usr/bin/env bash
set -eu
if [[ "$*" == *"vite build"* ]]; then
  test -f vendor/moonshine/fixture
else
  mkdir -p "$E2E_CAPTURE_DIR"
  cat vendor/moonshine/fixture > "$E2E_CAPTURE_DIR/dictation.chromium.light.png"
fi
`,
      { mode: 0o755 }
    );
    writeFileSync(
      join(bin, "node"),
      `#!/usr/bin/env bash
set -eu
mkdir -p "$E2E_CAPTURE_DIR"
cat vendor/moonshine/fixture > "$E2E_CAPTURE_DIR/dictation.chromium.light.png"
`,
      { mode: 0o755 }
    );
    const result = spawnSync("bash", ["scripts/pr-screenshots.sh", "-g", "dictation"], {
      cwd: repo,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        SCREENSHOTS_BASE: "HEAD",
        SCREENSHOTS_OUT: output,
        TMPDIR: root,
      },
    });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(readFileSync(join(output, "screenshots.md"), "utf8")).not.toContain("_not captured_");
    expect(readFileSync(join(output, "before", "dictation.chromium.light.png"), "utf8")).toBe(
      "downloaded runtime"
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
