// Regenerates src/features/dictation/catalog.json from Moonshine's pinned
// per-file metadata. Run when re-pinning Moonshine:
//   node scripts/gen-dictation-catalog.mjs v0.1.5
import { writeFileSync } from "node:fs";

const tag = process.argv[2] ?? "v0.1.5";
const metadataUrl = `https://raw.githubusercontent.com/moonshine-ai/moonshine/${tag}/core/moonshine-model-file-metadata.generated.cpp`;
const response = await fetch(metadataUrl);
if (!response.ok) throw new Error(`${metadataUrl}: HTTP ${response.status}`);
const src = await response.text();

const PICK = {
  "tiny-streaming-en": { lang: "en", tier: "fast", punct: true },
  "small-streaming-en": { lang: "en", tier: "accurate", punct: true },
  "tiny-streaming-es": { lang: "es", tier: "fast", punct: false },
  "small-streaming-es": { lang: "es", tier: "accurate", punct: false },
};

const models = {};
for (const m of src.matchAll(/\{((?:"[^"]*"\s*)+),\s*(\d+),\s*"([^"]*)",\s*"([^"]*)"\}/g)) {
  const url = [...m[1].matchAll(/"([^"]*)"/g)].map((x) => x[1]).join("");
  const mm = url.match(/^https:\/\/download\.moonshine\.ai\/model\/([a-z-]+)\/([^/]+)\/(.+)$/);
  if (!mm || !PICK[mm[1]] || mm[3].includes("with_attention")) continue;
  const model = (models[mm[1]] ??= { dir: mm[2], files: [] });
  // m[3] is the base64 checksum, m[4] its algorithm ("crc32c").
  model.files.push({
    name: mm[3],
    url,
    bytes: Number(m[2]),
    checksum: { algo: m[4], value: m[3] },
  });
}

const specs = Object.entries(PICK).map(([key, p]) => {
  const model = models[key];
  if (!model) throw new Error(`${key} missing from ${tag} metadata`);
  const size = key.split("-")[0];
  return {
    id: `moonshine-${size}-${p.lang}-${model.dir.replace("quantized_", "").replaceAll("_", "")}`,
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
  };
});

writeFileSync("src/features/dictation/catalog.json", `${JSON.stringify(specs, null, 2)}\n`);
console.log(
  specs
    .map((s) => `${s.id} ${s.files.length} files ${s.files.reduce((a, f) => a + f.bytes, 0)} bytes`)
    .join("\n")
);
