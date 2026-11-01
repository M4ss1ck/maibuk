// The Dictation Models Maibuk offers. The data lives in catalog.json, generated
// by scripts/gen-dictation-catalog.mjs from Moonshine's pinned metadata plus
// pinned Hugging Face files (sherpa-onnx models, issue #663). Adding a language
// or a model size is a new entry there; no other code changes. Moonshine's
// Spanish streaming models output lowercase text without punctuation (spike,
// 2026-09-27): see `capabilities`.
import data from "@/features/dictation/catalog.json";
import type { DictationPlatform, ModelSpec } from "@/features/dictation/types";

// The JSON's inferred type is a union of per-entry shapes (sherpa entries carry
// other engineOptions keys) that TypeScript cannot compare to ModelSpec; the
// shape is checked by validateCatalog, which the catalog test runs.
export const MODEL_CATALOG: readonly ModelSpec[] = data as unknown as ModelSpec[];

const CHECKSUM = /^[A-Za-z0-9+/]{6}==$/;

/** Problems with a catalog, one message each; empty when valid. */
export function validateCatalog(catalog: readonly ModelSpec[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const spec of catalog) {
    if (seen.has(spec.id)) problems.push(`duplicate id ${spec.id}`);
    seen.add(spec.id);
    if (spec.name.trim() === "") problems.push(`${spec.id}: no name`);
    if (!spec.source.startsWith("https://")) problems.push(`${spec.id}: source must be https`);
    if (spec.languages.length === 0) problems.push(`${spec.id}: no languages`);
    if (spec.platforms.length === 0) problems.push(`${spec.id}: no platforms`);
    if (spec.files.length === 0) problems.push(`${spec.id}: no files`);
    for (const file of spec.files) {
      const at = `${spec.id}/${file.name}`;
      if (!file.url.startsWith("https://")) problems.push(`${at}: url must be https`);
      if (!(file.bytes > 0)) problems.push(`${at}: bytes must be > 0`);
      if (file.checksum.algo !== "crc32c" || !CHECKSUM.test(file.checksum.value)) {
        problems.push(`${at}: checksum must be 4 bytes base64`);
      }
    }
  }
  return problems;
}

export function modelsFor(catalog: readonly ModelSpec[], platform: DictationPlatform): ModelSpec[] {
  return catalog.filter((spec) => spec.platforms.includes(platform));
}
