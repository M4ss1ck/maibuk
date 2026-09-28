// Downloads the Moonshine runtimes Dictation needs into vendor/moonshine/,
// pinned by SHA-256. Never committed (vendor/ is git-ignored).
//   pnpm fetch:dictation
//   pnpm fetch:dictation --test-assets
// `--test-assets` additionally downloads every model file listed in
// src/features/dictation/catalog.json (verified by size and CRC32C) into
// vendor/moonshine/models/<id>/, plus the Dictation test audio into
// vendor/moonshine/audio/.
// The npm package @moonshine-ai/moonshine-wasm@0.1.5 is NOT used: it was built
// from an older core that rejects the current model files and has no Spanish.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
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

const CATALOG_PATH = "src/features/dictation/catalog.json";
const AUDIO_DIR = "vendor/moonshine/audio";

const TWO_CITIES_URL =
  "https://raw.githubusercontent.com/moonshine-ai/moonshine/v0.1.5/test-assets/two_cities_16k.wav";
const QUIJOTE_URL =
  "https://archive.org/download/don_quijote_vol1_0706_librivox/quijote_vol1_02_cervantes_64kb.mp3";

async function fetchRuntime(root, runtime) {
  const dir = join(root, "vendor/moonshine", runtime.name);
  const stamp = join(dir, ".sha256");
  if (existsSync(stamp) && readFileSync(stamp, "utf8") === runtime.sha256) return;
  const res = await fetch(runtime.url);
  if (!res.ok) throw new Error(`${runtime.url}: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== runtime.sha256)
    throw new Error(`${runtime.name}: sha256 ${digest}, pinned ${runtime.sha256}`);
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

// CRC32C (Castagnoli), the checksum Moonshine publishes per model file. Kept
// dependency-free and mirrored from src/features/dictation/crc32c.ts so the
// checksum the app and the fetch script agree on is byte-identical.
const CRC32C_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0x82f63b78 : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

/** Incremental, so a download can be checked chunk by chunk as it arrives. */
export function createCrc32c() {
  let crc = 0xffffffff;
  return {
    update(bytes) {
      let c = crc;
      for (let i = 0; i < bytes.length; i++) c = CRC32C_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
      crc = c;
    },
    /** Base64 of the 4 big-endian bytes, the catalog's format. */
    digestBase64() {
      const value = (crc ^ 0xffffffff) >>> 0;
      const bytes = [value >>> 24, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
      return Buffer.from(bytes).toString("base64");
    },
  };
}

export function crc32cBase64(bytes) {
  const crc = createCrc32c();
  crc.update(bytes);
  return crc.digestBase64();
}

async function crc32cFile(path) {
  const crc = createCrc32c();
  for await (const chunk of createReadStream(path)) crc.update(chunk);
  return crc.digestBase64();
}

// Streams `url` to `<dest>.part`, then renames it into place. Returns the byte
// count and the CRC32C base64 of what was written, so the caller can verify.
async function downloadToFile(fetchImpl, url, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const crc = createCrc32c();
  let total = 0;
  const out = createWriteStream(part);
  try {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.length;
      crc.update(chunk);
      if (!out.write(chunk)) await once(out, "drain");
    }
    out.end();
    await once(out, "finish");
  } catch (error) {
    out.destroy();
    rmSync(part, { force: true });
    throw error;
  }
  return { part, total, crc32c: crc.digestBase64() };
}

async function fetchCatalogFiles(root, fetchImpl) {
  const catalog = JSON.parse(readFileSync(join(root, CATALOG_PATH), "utf8"));
  for (const entry of catalog) {
    for (const file of entry.files) {
      const dest = join(root, "vendor/moonshine/models", entry.id, file.name);
      if (
        existsSync(dest) &&
        statSync(dest).size === file.bytes &&
        (await crc32cFile(dest)) === file.checksum.value
      )
        continue;
      const { part, total, crc32c } = await downloadToFile(fetchImpl, file.url, dest);
      if (total !== file.bytes) {
        rmSync(part, { force: true });
        throw new Error(`${file.name}: size ${total}, expected ${file.bytes}`);
      }
      if (crc32c !== file.checksum.value) {
        rmSync(part, { force: true });
        throw new Error(`${file.name}: crc32c ${crc32c}, expected ${file.checksum.value}`);
      }
      renameSync(part, dest);
      console.log(relative(root, dest));
    }
  }
}

function requireFfmpeg(run) {
  try {
    run("ffmpeg", ["-version"], { stdio: "ignore" });
  } catch {
    throw new Error(
      "ffmpeg is required to build the Dictation test audio; install ffmpeg and retry"
    );
  }
}

function runFfmpeg(run, args) {
  run("ffmpeg", ["-loglevel", "error", "-y", ...args]);
}

async function fetchTestAudio(root, fetchImpl, run) {
  const dir = join(root, AUDIO_DIR);
  mkdirSync(dir, { recursive: true });
  const twoCities = join(dir, "two_cities_16k.wav");
  const short = join(dir, "two_cities_short.wav");
  const quijote = join(dir, "quijote_es_16k.wav");

  if (!existsSync(twoCities)) {
    const { part } = await downloadToFile(fetchImpl, TWO_CITIES_URL, twoCities);
    renameSync(part, twoCities);
    console.log(relative(root, twoCities));
  }

  const needShort = !existsSync(short);
  const needQuijote = !existsSync(quijote);
  if (needShort || needQuijote) requireFfmpeg(run);

  if (needShort) {
    runFfmpeg(run, ["-i", twoCities, "-t", "5", short]);
    console.log(relative(root, short));
  }

  if (needQuijote) {
    const mp3 = join(dir, "quijote-source.mp3");
    const { part } = await downloadToFile(fetchImpl, QUIJOTE_URL, mp3);
    renameSync(part, mp3);
    try {
      runFfmpeg(run, [
        "-i",
        mp3,
        "-t",
        "120",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-sample_fmt",
        "s16",
        quijote,
      ]);
    } finally {
      rmSync(mp3, { force: true });
    }
    console.log(relative(root, quijote));
  }
}

/**
 * Fetches the Dictation test assets: every catalog model file into
 * vendor/moonshine/models/<id>/ (skipping a present file whose size and CRC32C
 * match, and throwing on a mismatch), then the test WAVs into
 * vendor/moonshine/audio/. `fetchImpl` and `run` are injectable for tests.
 */
export async function fetchTestAssets(root, { fetchImpl = fetch, run = execFileSync } = {}) {
  await fetchCatalogFiles(root, fetchImpl);
  await fetchTestAudio(root, fetchImpl, run);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  for (const runtime of RUNTIMES) await fetchRuntime(root, runtime);
  if (process.argv.includes("--test-assets")) await fetchTestAssets(root);
}
