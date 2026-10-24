import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

interface Run {
  status: number | null;
  log: string;
  before: string;
  markdown: string;
  baseNodeModulesIsLink: boolean;
}

/** Runs the script in a throwaway repo whose base is HEAD, with pnpm and node faked. */
function runScreenshots({ lockfileDiffers }: { lockfileDiffers: boolean }): Run {
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
  writeFileSync(join(repo, "pnpm-lock.yaml"), "lockfileVersion: base\n");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "pipe" });
  try {
    git("init", "-b", "screenshot-test");
    git("add", "scripts", "e2e", ".gitignore", "pnpm-lock.yaml");
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
    // The branch changed its dependencies after the base commit.
    if (lockfileDiffers) writeFileSync(join(repo, "pnpm-lock.yaml"), "lockfileVersion: branch\n");
    writeFileSync(
      join(bin, "pnpm"),
      `#!/usr/bin/env bash
set -eu
echo "pnpm $*" >> "${root}/calls.log"
if [[ "$1" == "install" ]]; then
  mkdir -p node_modules
elif [[ "$*" == *"vite build"* ]]; then
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
    const pnpmCalls = readFileSync(join(root, "calls.log"), "utf8");
    return {
      status: result.status,
      log: `${result.stdout}${result.stderr}\n${pnpmCalls}`,
      before: readFileSync(join(output, "before", "dictation.chromium.light.png"), "utf8"),
      markdown: readFileSync(join(output, "screenshots.md"), "utf8"),
      baseNodeModulesIsLink: !pnpmCalls.includes("pnpm install"),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

it("makes downloaded Dictation assets available to the before screenshot build", () => {
  const run = runScreenshots({ lockfileDiffers: false });

  expect(run.status, run.log).toBe(0);
  expect(run.markdown).not.toContain("_not captured_");
  expect(run.before).toBe("downloaded runtime");
  expect(run.baseNodeModulesIsLink).toBe(true);
});

it("installs the base's own dependencies when the branch changed the lockfile", () => {
  const run = runScreenshots({ lockfileDiffers: true });

  expect(run.status, run.log).toBe(0);
  expect(run.log).toContain("pnpm install --offline --frozen-lockfile");
  expect(run.before).toBe("downloaded runtime");
});
