// Downloads the Moonshine runtimes Dictation needs into vendor/moonshine/,
// pinned by SHA-256. Never committed (vendor/ is git-ignored).
//   pnpm fetch:dictation
// The npm package @moonshine-ai/moonshine-wasm@0.1.5 is NOT used: it was built
// from an older core that rejects the current model files and has no Spanish.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const RUNTIMES = [
  {
    name: "wasm",
    url: "https://github.com/moonshine-ai/moonshine/releases/download/v0.1.5/moonshine-voice-wasm.tar.gz",
    sha256: "c515bf7691e12048f70a92cc82b3b0894c16c3773ffcacb7d48944fb150e4837",
    stripComponents: 0,
  },
  {
    name: "linux-x86_64",
    url: "https://github.com/moonshine-ai/moonshine/releases/download/v0.1.5/moonshine-voice-linux-x86_64.tar.gz",
    sha256: "9c3a87fea93ff2ad957938868f95a0a366dce9ff8ad86bde6cdcf5a4cadb51df",
    stripComponents: 1,
  },
];

async function fetchRuntime(root, runtime) {
  const dir = join(root, "vendor/moonshine", runtime.name);
  const stamp = join(dir, ".sha256");
  if (existsSync(stamp) && readFileSync(stamp, "utf8") === runtime.sha256)
    return;
  const res = await fetch(runtime.url);
  if (!res.ok) throw new Error(`${runtime.url}: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== runtime.sha256)
    throw new Error(
      `${runtime.name}: sha256 ${digest}, pinned ${runtime.sha256}`,
    );
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const tgz = join(dir, "runtime.tar.gz");
  writeFileSync(tgz, bytes);
  execFileSync("tar", [
    "xzf",
    tgz,
    "-C",
    dir,
    `--strip-components=${runtime.stripComponents}`,
    "--exclude=._*",
    "--warning=no-unknown-keyword",
  ]);
  rmSync(tgz);
  writeFileSync(stamp, runtime.sha256);
  console.log(`vendor/moonshine/${runtime.name}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  for (const runtime of RUNTIMES) await fetchRuntime(root, runtime);
}
