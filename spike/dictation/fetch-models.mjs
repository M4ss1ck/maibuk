// PROTOTYPE. Downloads the pinned Moonshine streaming models listed in
// models.json (parsed from core/moonshine-model-file-metadata.generated.cpp at
// v0.1.5) into public/models/<name>/, so the page loads them from its own
// origin. Checks each file's size; the catalog's CRC32C is kept in models.json.
//
// Also fetches the Moonshine WASM runtime from the v0.1.5 GitHub release into
// vendor/moonshine-wasm/. The npm package @moonshine-ai/moonshine-wasm@0.1.5
// was built from an older core: it rejects frontend.model.ort and its catalog
// has no Spanish streaming model.
import { execFileSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const models = JSON.parse(readFileSync(join(here, "models.json"), "utf8"));
const only = process.argv.slice(2);

const vendor = join(here, "vendor/moonshine-wasm");
if (!existsSync(join(vendor, "dist/moonshine.wasm"))) {
  mkdirSync(vendor, { recursive: true });
  const tgz = join(vendor, "moonshine-voice-wasm.tar.gz");
  const res = await fetch("https://github.com/moonshine-ai/moonshine/releases/download/v0.1.5/moonshine-voice-wasm.tar.gz");
  if (!res.ok) throw new Error(`runtime: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tgz));
  execFileSync("tar", ["xzf", tgz, "-C", vendor, "--exclude=._*", "--warning=no-unknown-keyword"]);
  console.log("vendor/moonshine-wasm from release v0.1.5");
}

for (const [name, { files }] of Object.entries(models)) {
  if (only.length && !only.includes(name)) continue;
  const dir = join(here, "public/models", name);
  mkdirSync(dir, { recursive: true });
  for (const [file, { url, size }] of Object.entries(files)) {
    const dest = join(dir, file);
    if (existsSync(dest) && statSync(dest).size === size) continue;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
    const got = statSync(dest).size;
    if (got !== size) throw new Error(`${dest}: ${got} bytes, catalog says ${size}`);
    console.log(`${name}/${file} ${(size / 1e6).toFixed(1)} MB`);
  }
}
