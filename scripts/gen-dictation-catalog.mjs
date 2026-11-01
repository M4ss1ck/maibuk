// Regenerates src/features/dictation/catalog.json. Two sources:
//   - Moonshine: per-file metadata from its pinned release tag.
//   - sherpa-onnx (HF): files pinned by Hugging Face commit. Each file is
//     hashed from vendor/moonshine/models/<id>/<name> when that copy exists,
//     else streamed from its URL. Sizes are cross-checked against the remote
//     Content-Length when the copy is hand-verified (issue #663).
// Run when re-pinning Moonshine or adding a sherpa model:
//   pnpm exec tsx scripts/gen-dictation-catalog.mjs v0.1.5
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCrc32c } from "../src/features/dictation/crc32c.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const tag = process.argv[2] ?? "v0.1.5";
const metadataUrl = `https://raw.githubusercontent.com/moonshine-ai/moonshine/${tag}/core/moonshine-model-file-metadata.generated.cpp`;
const response = await fetch(metadataUrl);
if (!response.ok) throw new Error(`${metadataUrl}: HTTP ${response.status}`);
const src = await response.text();

const MOONSHINE_SOURCE = "https://huggingface.co/moonshine-ai/moonshine-streaming";
const PICK = {
  "tiny-streaming-en": { name: "Moonshine Tiny English", lang: "en", tier: "fast", punct: true },
  "small-streaming-en": {
    name: "Moonshine Small English",
    lang: "en",
    tier: "accurate",
    punct: true,
  },
  "tiny-streaming-es": { name: "Moonshine Tiny Spanish", lang: "es", tier: "fast", punct: false },
  "small-streaming-es": {
    name: "Moonshine Small Spanish",
    lang: "es",
    tier: "accurate",
    punct: false,
  },
};

const models = {};
for (const m of src.matchAll(/\{((?:"[^"]*"\s*)+),\s*(\d+),\s*"([^"]*)",\s*"([^"]*)"\}/g)) {
  const url = [...m[1].matchAll(/"([^"]*)"/g)].map((x) => x[1]).join("");
  const mm = url.match(/^https:\/\/download\.moonshine\.ai\/model\/([a-z-]+)\/([^/]+)\/(.+)$/);
  if (!mm || !PICK[mm[1]] || mm[3].includes("with_attention")) continue;
  models[mm[1]] ??= { dir: mm[2], files: [] };
  const model = models[mm[1]];
  // m[3] is the base64 checksum, m[4] its algorithm ("crc32c").
  model.files.push({
    name: mm[3],
    url,
    bytes: Number(m[2]),
    checksum: { algo: m[4], value: m[3] },
  });
}

const moonshine = Object.entries(PICK).map(([key, p]) => {
  const model = models[key];
  if (!model) throw new Error(`${key} missing from ${tag} metadata`);
  const size = key.split("-")[0];
  return {
    id: `moonshine-${size}-${p.lang}-${model.dir.replace("quantized_", "").replaceAll("_", "")}`,
    name: p.name,
    engine: "moonshine",
    languages: [p.lang],
    tier: p.tier,
    platforms: ["web", "tauri-linux"],
    files: model.files.sort((a, b) => a.name.localeCompare(b.name)),
    engineOptions: {
      arch: size === "tiny" ? "tiny-streaming" : "small-streaming",
      transcription_interval: "0.2",
    },
    capabilities: { casing: p.punct, punctuation: p.punct, streaming: true },
    source: MOONSHINE_SOURCE,
  };
});

/** Files of one Hugging Face repo, pinned to a commit. */
function pinned(repo, sha, names) {
  return names.map((name) => ({ repo, sha, name }));
}

const HF = [
  {
    id: "canary-180m-flash-int8-9077164",
    name: "Canary 180M Flash",
    languages: ["en", "es"],
    tier: "accurate",
    platforms: ["tauri-linux"],
    source: "https://huggingface.co/nvidia/canary-180m-flash",
    capabilities: { casing: true, punctuation: true, streaming: false },
    engineOptions: {
      model: "canary",
      encoder: "encoder.int8.onnx",
      decoder: "decoder.int8.onnx",
      tokens: "tokens.txt",
      vad: "silero_vad.onnx",
      min_silence: "0.5",
      max_line: "8",
    },
    pins: [
      ...pinned(
        "csukuangfj/sherpa-onnx-nemo-canary-180m-flash-en-es-de-fr-int8",
        "9077164e0d3dd1d5353743e89ceaa1d3a770838c",
        ["decoder.int8.onnx", "encoder.int8.onnx", "tokens.txt"]
      ),
      ...pinned("csukuangfj/vad", "fba88cd2e921609e7675c3aaf51e0b9b295da4bc", ["silero_vad.onnx"]),
    ],
  },
  {
    id: "nemotron-3.5-streaming-160ms-int8-b3a4dbd",
    name: "Nemotron 3.5 Streaming",
    languages: ["en", "es"],
    tier: "accurate",
    platforms: ["tauri-linux"],
    source: "https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b",
    capabilities: { casing: true, punctuation: true, streaming: true },
    engineOptions: {
      model: "transducer",
      encoder: "encoder.int8.onnx",
      decoder: "decoder.int8.onnx",
      joiner: "joiner.int8.onnx",
      tokens: "tokens.txt",
    },
    pins: pinned(
      "csukuangfj2/sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-160ms-int8-2026-06-11",
      "b3a4dbde84fba1a13cb4270e6730b525ac6a2db6",
      ["decoder.int8.onnx", "encoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"]
    ),
  },
];

/** Bytes and CRC32C of one pinned file, read from the vendored copy when present. */
async function measure(id, pin) {
  const url = `https://huggingface.co/${pin.repo}/resolve/${pin.sha}/${pin.name}`;
  const local = join(ROOT, "vendor/moonshine/models", id, pin.name);
  let chunks;
  if (existsSync(local)) {
    chunks = createReadStream(local);
  } else {
    const download = await fetch(url);
    if (!download.ok) throw new Error(`${url}: HTTP ${download.status}`);
    chunks = download.body;
  }
  const crc = createCrc32c();
  let bytes = 0;
  for await (const chunk of chunks) {
    crc.update(chunk);
    bytes += chunk.length;
  }
  return { name: pin.name, url, bytes, checksum: { algo: "crc32c", value: crc.digestBase64() } };
}

const sherpa = [];
for (const entry of HF) {
  const files = [];
  for (const pin of entry.pins) files.push(await measure(entry.id, pin));
  sherpa.push({
    id: entry.id,
    name: entry.name,
    engine: "sherpa",
    languages: entry.languages,
    tier: entry.tier,
    platforms: entry.platforms,
    files: files.sort((a, b) => a.name.localeCompare(b.name)),
    engineOptions: entry.engineOptions,
    capabilities: entry.capabilities,
    source: entry.source,
  });
}

const specs = [...moonshine, ...sherpa];
const out = join(ROOT, "src/features/dictation/catalog.json");
writeFileSync(out, `${JSON.stringify(specs, null, 2)}\n`);
// Biome folds short arrays onto one line, the layout the repo lints against.
execFileSync(join(ROOT, "node_modules/.bin/biome"), ["format", "--write", out], {
  stdio: "ignore",
});
console.log(
  specs
    .map((s) => `${s.id} ${s.files.length} files ${s.files.reduce((a, f) => a + f.bytes, 0)} bytes`)
    .join("\n")
);
