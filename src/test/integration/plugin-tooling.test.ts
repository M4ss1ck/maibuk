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
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import { buildPlugin } from "../../../scripts/build-plugin";
import { isBuiltInPlugin } from "../../../scripts/plugin/builtin";
import { externalAliases, writeGeneratedConfigs } from "../../../scripts/plugin/config";
import { checkImportBoundary } from "../../../scripts/plugin/import-boundary";
import { checkFolderLayout } from "../../../scripts/plugin/layout";
import { linkSkill } from "../../../templates/plugin/scripts/setup.mjs";

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

/**
 * Imports a built entry the way the sandbox prelude does, in a scope with a
 * Worker's `self` and no DOM, so an entry that touches `HTMLElement` before the
 * Remote DOM polyfill is installed exits non-zero.
 */
function evaluateInWorkerScope(entry: string): Promise<ChildResult> {
  const script = [
    "globalThis.self = { addEventListener() {}, postMessage() {} };",
    `await import(${JSON.stringify(pathToFileURL(entry).href)});`,
  ].join("\n");
  return node("--input-type=module", ["--eval", script], dirname(entry));
}

/** Every file under `dir`, with forward slashes, sorted. */
function listFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true })
    .map((entry) => String(entry).replace(/\\/g, "/"))
    .sort();
}

/** The lane's timeout; `TIMEOUT_EXCEPTIONS` lists the file with the reason. */
const SLOW_LANE_TIMEOUT_MS = 300_000;

describe("linkSkill()", () => {
  it("links both skill paths to the checkout's skill folder", () => {
    const checkout = tempRoot("maibuk checkout ");
    mkdirSync(join(checkout, "skills/maibuk-plugin"), { recursive: true });
    writeFileSync(join(checkout, "skills/maibuk-plugin/SKILL.md"), "# skill\n");
    const pluginRoot = tempRoot("maibuk plugin root ");

    linkSkill(checkout, pluginRoot);

    const source = join(checkout, "skills/maibuk-plugin");
    for (const link of [".agents/skills/maibuk-plugin", ".claude/skills/maibuk-plugin"]) {
      const target = join(pluginRoot, link);
      expect(existsSync(target), link).toBe(true);
      expect(existsSync(join(target, "SKILL.md")), link).toBe(true);
      expect(realpathSync(target), link).toBe(realpathSync(source));
    }
  });

  it("warns and links nothing when the checkout does not carry the skill", () => {
    const checkout = tempRoot("maibuk checkout without skill ");
    const pluginRoot = tempRoot("maibuk plugin root without skill ");

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    linkSkill(checkout, pluginRoot);
    const calls = warn.mock.calls.map((call) => String(call[0]));
    warn.mockRestore();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain(join(checkout, "skills/maibuk-plugin"));
    expect(existsSync(join(pluginRoot, ".agents/skills/maibuk-plugin"))).toBe(false);
    expect(existsSync(join(pluginRoot, ".claude/skills/maibuk-plugin"))).toBe(false);
  });
});

describe("isBuiltInPlugin()", () => {
  /** A temp checkout holding `plugins/<dir>/manifest.json` with `id`. */
  function checkoutWith(dir: string, id: string): { maibukRoot: string; pluginRoot: string } {
    const maibukRoot = tempRoot("maibuk checkout ");
    const pluginRoot = join(maibukRoot, "plugins", dir);
    mkdirSync(pluginRoot, { recursive: true });
    writeFileSync(pluginRoot + "/manifest.json", `${JSON.stringify({ id })}\n`);
    return { maibukRoot, pluginRoot };
  }

  it("is a Built-in for a plugins/<id> child whose folder matches the manifest id", () => {
    const { maibukRoot, pluginRoot } = checkoutWith("maibuk-echoes", "maibuk-echoes");

    expect(isBuiltInPlugin(pluginRoot, maibukRoot)).toBe(true);
  });

  it("is not a Built-in for a folder elsewhere", () => {
    const maibukRoot = tempRoot("maibuk checkout elsewhere ");
    const pluginRoot = join(tempRoot("third party plugin "), "maibuk-echoes");
    mkdirSync(pluginRoot, { recursive: true });
    writeFileSync(pluginRoot + "/manifest.json", `${JSON.stringify({ id: "maibuk-echoes" })}\n`);

    expect(isBuiltInPlugin(pluginRoot, maibukRoot)).toBe(false);
  });

  it("is not a Built-in when the folder name differs from the manifest id", () => {
    const { maibukRoot, pluginRoot } = checkoutWith("other-name", "maibuk-echoes");

    expect(isBuiltInPlugin(pluginRoot, maibukRoot)).toBe(false);
  });

  it("is not a Built-in when the manifest is missing", () => {
    const maibukRoot = tempRoot("maibuk checkout no manifest ");
    const pluginRoot = join(maibukRoot, "plugins", "maibuk-echoes");
    mkdirSync(pluginRoot, { recursive: true });

    expect(isBuiltInPlugin(pluginRoot, maibukRoot)).toBe(false);
  });
});

describe("checkImportBoundary() for a Built-in", () => {
  /** A temp Plugin folder with `relPath` holding `text`. */
  function writePluginFile(root: string, relPath: string, text: string): void {
    const target = join(root, relPath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
  }

  it("accepts @/plugin-sdk in a shipped file and refuses other @/ modules there", () => {
    const root = tempRoot("maibuk builtin boundary ");
    writePluginFile(
      root,
      "index.ts",
      [
        'import { createPluginClient } from "@/plugin-sdk";',
        'import { servePluginUi } from "@/plugin-sdk/worker-ui";',
        'import { helper } from "./helper";',
        "",
      ].join("\n")
    );
    writePluginFile(root, "helper.ts", "export const helper = 1;\n");
    writePluginFile(root, "bad.ts", 'import "@/features/plugins/thing";\n');

    const { violations } = checkImportBoundary(root, { builtIn: true });

    expect(violations.map((violation) => violation.file)).toEqual(["bad.ts"]);
    expect(violations[0].specifier).toBe("@/features/plugins/thing");
  });

  it("accepts any @/ module in a Built-in test file", () => {
    const root = tempRoot("maibuk builtin boundary tests ");
    writePluginFile(
      root,
      "entry.test.ts",
      [
        'import { createTestHost } from "@/features/plugins/test-kit";',
        'import "@/i18n";',
        'import { helper } from "./helper";',
        "",
      ].join("\n")
    );
    writePluginFile(root, "helper.ts", "export const helper = 1;\n");

    expect(checkImportBoundary(root, { builtIn: true }).violations).toEqual([]);
  });

  it("still refuses @/plugin-sdk for a third-party Plugin", () => {
    const root = tempRoot("maibuk third party boundary ");
    writePluginFile(root, "index.ts", 'import { createPluginClient } from "@/plugin-sdk";\n');

    const { violations } = checkImportBoundary(root, {});

    expect(violations).toHaveLength(1);
    expect(violations[0].specifier).toBe("@/plugin-sdk");
  });

  it("accepts a relative import that stays inside a Built-in under the checkout", () => {
    const maibukRoot = tempRoot("maibuk checkout boundary ");
    const root = join(maibukRoot, "plugins", "maibuk-sample");
    writePluginFile(root, "index.ts", 'import { helper } from "./helper";\n');
    writePluginFile(root, "helper.ts", "export const helper = 1;\n");

    expect(checkImportBoundary(root, { maibukRoot, builtIn: true }).violations).toEqual([]);
  });
});

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

    it("still checks after the quickstart renames the Plugin id", async () => {
      const plugin = join(tempRoot("maibuk plugin renamed "), "my plugin");
      copyTemplate(plugin);
      const manifestFile = join(plugin, "manifest.json");
      const manifest = readFileSync(manifestFile, "utf8");
      writeFileSync(manifestFile, manifest.replace('"id": "hello-plugin"', '"id": "my-plugin"'));

      const setup = await node("scripts/setup.mjs", ["--maibuk", REPO_ROOT], plugin);
      expect(setup.code, setup.stdout + setup.stderr).toBe(0);
      const check = await node("scripts/maibuk.mjs", ["check"], plugin);
      expect(check.code, check.stdout + check.stderr).toBe(0);
      expect(existsSync(join(plugin, "dist/my-plugin-0.1.0.zip"))).toBe(true);
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

    it("resolves react and react-dom to Maibuk's copy, never the Plugin's own", async () => {
      const plugin = join(tempRoot("maibuk plugin one react "), "hello plugin");
      copyTemplate(plugin);

      // The Plugin's own `node_modules` holds a decoy react and react-dom: each
      // re-exports a marker string and throws the moment it runs. React is
      // pinned to Maibuk's copy (one React per renderer), so the build must not
      // bundle the marker and the test run must not load the decoy: `check`
      // still exits 0 and the marker never reaches `dist/<id>/index.js`.
      const marker = "plugin-copy-react-marker-0.0.0";
      for (const name of ["react", "react-dom"]) {
        const dir = join(plugin, "node_modules", name);
        mkdirSync(dir, { recursive: true });
        writeFileSync(
          join(dir, "package.json"),
          `${JSON.stringify({ name, version: "0.0.0-plugin-copy", type: "module", main: "index.js" })}\n`
        );
        writeFileSync(
          join(dir, "index.js"),
          `export const MARKER = ${JSON.stringify(marker)};\nthrow new Error(${JSON.stringify(
            `the Plugin's own copy of ${name} must not be used`
          )});\n`
        );
      }

      await node("scripts/setup.mjs", ["--maibuk", REPO_ROOT], plugin);
      const check = await node("scripts/maibuk.mjs", ["check"], plugin);
      expect(check.code, check.stdout + check.stderr).toBe(0);

      const bundle = readFileSync(join(plugin, "dist/hello-plugin/index.js"), "utf8");
      expect(bundle).not.toContain(marker);
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

        const entry = await evaluateInWorkerScope(join(dir, "index.js"));
        expect(entry.code, `${dir}: ${entry.stdout}${entry.stderr}`).toBe(0);
      }
    });
  }
);
