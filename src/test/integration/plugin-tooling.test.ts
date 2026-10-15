// @vitest-environment node
/**
 * The slow Plugin-tooling lane (issue #455, unit U3). It runs the real
 * toolchain end to end over the template copied into a path with spaces: setup
 * writes the configs, `maibuk.mjs check` builds, tests, packages, and checks the
 * layout; an invalid checkout fails with an actionable message; a private import
 * fails at the boundary; and a built-in and the template build to the same valid
 * layout. Gated because it spawns tsx, Vite, tsc, biome, and vitest as child
 * processes: run it with `pnpm test:plugin-tooling`.
 */
import { spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildPlugin } from "../../../scripts/build-plugin";
import { externalAliases, writeGeneratedConfigs } from "../../../scripts/plugin/config";
import { checkFolderLayout } from "../../../scripts/plugin/layout";

const REPO_ROOT = resolve(__dirname, "../../..");
const TEMPLATE_DIR = join(REPO_ROOT, "templates/plugin");
const ECHOES_DIR = join(REPO_ROOT, "plugins/maibuk-echoes");

/** Folders and files the copy skips: generated, installed, or machine-specific. */
const IGNORED = new Set(["node_modules", "dist", ".maibuk", "maibuk.local.json"]);

const roots: string[] = [];

afterAll(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A fresh temp root; every one is removed after the lane. */
function tempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

/** Copies the template into `dest`, skipping generated and installed folders. */
function copyTemplate(dest: string): void {
  cpSync(TEMPLATE_DIR, dest, {
    recursive: true,
    filter: (source) => !IGNORED.has(basename(source)),
  });
}

/** A finished child process. */
interface ChildResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs `script args...` with `node` in `cwd`, capturing output. */
function node(script: string, args: readonly string[], cwd: string): Promise<ChildResult> {
  return new Promise((settle) => {
    const child = spawn(process.execPath, [script, ...args], { cwd, env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => settle({ code: 1, stdout, stderr: `${stderr}${error.message}` }));
    child.on("close", (code) => settle({ code: code ?? 1, stdout, stderr }));
  });
}

/** Every file under `dir`, with forward slashes, sorted. */
function listFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true })
    .map((entry) => String(entry).replace(/\\/g, "/"))
    .sort();
}

/** The lane's timeout; `TIMEOUT_EXCEPTIONS` lists the file with the reason. */
const SLOW_LANE_TIMEOUT_MS = 300_000;

// time-budget: TIMEOUT_EXCEPTIONS lists this lane's child-process runs.
describe.skipIf(!process.env.MAIBUK_PLUGIN_TOOLING)(
  "Plugin tooling (slow lane)",
  { timeout: SLOW_LANE_TIMEOUT_MS },
  () => {
    it("checks a template copied into a path with spaces", async () => {
      const plugin = join(tempRoot("maibuk plugin tooling "), "hello plugin");
      copyTemplate(plugin);

      const setup = await node("scripts/setup.mjs", ["--maibuk", REPO_ROOT], plugin);
      expect(setup.code, setup.stdout + setup.stderr).toBe(0);
      expect(existsSync(join(plugin, "maibuk.local.json"))).toBe(true);
      expect(existsSync(join(plugin, ".maibuk/tsconfig.paths.json"))).toBe(true);

      const check = await node("scripts/maibuk.mjs", ["check"], plugin);
      expect(check.code, check.stdout + check.stderr).toBe(0);
      expect(existsSync(join(plugin, "dist/hello-plugin-0.1.0.zip"))).toBe(true);
    });

    it("fails with an actionable message when maibuk.local.json is wrong", async () => {
      const plugin = join(tempRoot("maibuk plugin bad checkout "), "hello plugin");
      copyTemplate(plugin);
      const localFile = join(plugin, "maibuk.local.json");

      const missing = join(plugin, "no such checkout");
      writeFileSync(localFile, `${JSON.stringify({ maibukCheckout: missing })}\n`);
      const absent = await node("scripts/maibuk.mjs", ["check"], plugin);
      expect(absent.code).not.toBe(0);
      expect(absent.stderr).toContain(missing);
      expect(absent.stderr).toMatch(/setup\.mjs --maibuk/);

      const notCheckout = tempRoot("not a maibuk checkout ");
      writeFileSync(localFile, `${JSON.stringify({ maibukCheckout: notCheckout })}\n`);
      const wrong = await node("scripts/maibuk.mjs", ["check"], plugin);
      expect(wrong.code).not.toBe(0);
      expect(wrong.stderr).toContain(notCheckout);
      expect(wrong.stderr).toMatch(/package\.json/);
      expect(wrong.stderr).toMatch(/setup\.mjs --maibuk/);
    });

    it("fails at the import boundary for a private import", async () => {
      const plugin = join(tempRoot("maibuk plugin boundary "), "hello plugin");
      copyTemplate(plugin);
      // Setup first: the build needs the generated `.maibuk` configs the
      // template's own `tsconfig.json` extends.
      await node("scripts/setup.mjs", ["--maibuk", REPO_ROOT], plugin);
      const entry = join(plugin, "index.tsx");
      // A private module the build resolves through the `@` alias, so the build
      // and typecheck pass and the boundary is the step that fails.
      writeFileSync(
        entry,
        `import "@/features/plugins/relative-path";\n${readFileSync(entry, "utf8")}`
      );

      const check = await node("scripts/maibuk.mjs", ["check"], plugin);
      expect(check.code, check.stdout + check.stderr).not.toBe(0);
      expect(check.stdout).toContain("FAIL boundary");
      expect(check.stdout).toMatch(/index\.tsx:\d+ @\/features\/plugins\/relative-path/);
    });

    it("builds a built-in and the template to the same valid layout", async () => {
      const outRoot = tempRoot("maibuk plugin builds ");

      const echoesOut = join(outRoot, "maibuk-echoes");
      await buildPlugin({
        sourceDir: ECHOES_DIR,
        manifestPath: join(ECHOES_DIR, "manifest.json"),
        outDir: echoesOut,
      });

      // A ready template copy: esbuild reads the template's `tsconfig.json`,
      // which extends the generated `.maibuk/tsconfig.paths.json`, so that file
      // must exist before a build.
      const templateSource = join(tempRoot("maibuk plugin template "), "hello plugin");
      copyTemplate(templateSource);
      await writeGeneratedConfigs(templateSource, REPO_ROOT);

      const templateOut = join(outRoot, "hello-plugin");
      await buildPlugin({
        sourceDir: templateSource,
        manifestPath: join(templateSource, "manifest.json"),
        outDir: templateOut,
        alias: externalAliases(REPO_ROOT),
      });

      for (const [dir, source] of [
        [echoesOut, ECHOES_DIR],
        [templateOut, templateSource],
      ] as const) {
        const { problems } = checkFolderLayout(dir, { forbiddenStrings: [REPO_ROOT, source] });
        expect(problems, dir).toEqual([]);

        const files = listFiles(dir);
        expect(files, dir).toContain("manifest.json");
        expect(
          files.some((file) => file.endsWith(".js")),
          dir
        ).toBe(true);
        expect(
          files.filter((file) => /\.(ts|tsx|map)$/.test(file)),
          dir
        ).toEqual([]);
      }
    });
  }
);
